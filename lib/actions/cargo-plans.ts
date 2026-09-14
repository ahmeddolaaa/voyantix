"use server";

import { db } from "@/db/client";
import { cargoPlans, voyagePortCalls } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * CARGO PLAN — the cargo intended for a port call (Phase 4).
 *
 * A port call may carry more than one plan. That is legitimate data, but it
 * makes automatic term resolution impossible (PO11): applicability needs
 * exactly one cargo, so the resolve action reports MULTIPLE_CARGO_CONTEXTS
 * rather than picking one. Nothing here tries to mark a "primary" plan —
 * inventing one would be exactly the silent guess PO11 forbids.
 *
 * Quantities are numeric, carried as strings so PostgreSQL's precision
 * survives the round trip. actualQuantityMt is null until the operation is
 * complete; there is no lifecycle/status column, because a plan is a line
 * item of its port call, not an independently referenced record.
 */

export type CargoPlanRow = {
  id: string;
  portCallId: string;
  cargoId: string;
  plannedQuantityMt: string;
  actualQuantityMt: string | null;
};

async function cargoPlanAction<T>(
  permission: Parameters<typeof authorized>[0],
  fn: Parameters<typeof authorized<ActionResult<T>>>[1]
): Promise<ActionResult<T>> {
  try {
    return await authorized<ActionResult<T>>(permission, fn);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<T>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}

export type CargoPlanInput = {
  cargoId: string;
  plannedQuantityMt: string;
  actualQuantityMt?: string | null;
};

type ValidatedCargoPlan = {
  cargoId: string;
  plannedQuantityMt: string;
  actualQuantityMt: string | null;
};

const NUMERIC = /^-?\d+(\.\d+)?$/;

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function validateCargoPlanInput(
  input: CargoPlanInput
): ActionResult<ValidatedCargoPlan> {
  const cargoId = (input.cargoId ?? "").trim();
  if (cargoId === "") {
    return fail("VALIDATION_ERROR", "A cargo is required.");
  }

  const planned = (input.plannedQuantityMt ?? "").trim();
  if (!NUMERIC.test(planned)) {
    return fail("VALIDATION_ERROR", "Planned quantity must be a number.");
  }
  if (Number(planned) < 0) {
    return fail("VALIDATION_ERROR", "Planned quantity cannot be negative.");
  }

  const actual = trimOrNull(input.actualQuantityMt);
  if (actual !== null) {
    if (!NUMERIC.test(actual)) {
      return fail("VALIDATION_ERROR", "Actual quantity must be a number.");
    }
    if (Number(actual) < 0) {
      return fail("VALIDATION_ERROR", "Actual quantity cannot be negative.");
    }
  }

  return ok({ cargoId, plannedQuantityMt: planned, actualQuantityMt: actual });
}

/** Confirms the port call exists inside the caller's organization. */
async function portCallInOrg(
  portCallId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: voyagePortCalls.id })
    .from(voyagePortCalls)
    .where(
      and(
        eq(voyagePortCalls.id, portCallId),
        eq(voyagePortCalls.organizationId, organizationId)
      )
    );
  return rows.length > 0;
}

export async function listCargoPlans(
  portCallId: string
): Promise<ActionResult<CargoPlanRow[]>> {
  return cargoPlanAction<CargoPlanRow[]>("masterdata.read", async (ctx) => {
    if (!(await portCallInOrg(portCallId, ctx.organizationId))) {
      return fail<CargoPlanRow[]>("NOT_FOUND", "Port call not found.");
    }

    const rows = await db
      .select({
        id: cargoPlans.id,
        portCallId: cargoPlans.portCallId,
        cargoId: cargoPlans.cargoId,
        plannedQuantityMt: cargoPlans.plannedQuantityMt,
        actualQuantityMt: cargoPlans.actualQuantityMt,
      })
      .from(cargoPlans)
      .where(
        and(
          eq(cargoPlans.portCallId, portCallId),
          eq(cargoPlans.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(cargoPlans.createdAt));

    return ok(rows as CargoPlanRow[]);
  });
}

export async function createCargoPlan(
  portCallId: string,
  input: CargoPlanInput
): Promise<ActionResult<{ id: string }>> {
  return cargoPlanAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateCargoPlanInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    if (!(await portCallInOrg(portCallId, ctx.organizationId))) {
      return fail<{ id: string }>("NOT_FOUND", "Port call not found.");
    }

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(cargoPlans)
        .values({
          organizationId: ctx.organizationId,
          portCallId,
          cargoId: v.cargoId,
          plannedQuantityMt: v.plannedQuantityMt,
          actualQuantityMt: v.actualQuantityMt,
        })
        .returning({ id: cargoPlans.id });

      await recordAudit(ctx, {
        entityType: "CargoPlan",
        entityId: created.id,
        action: "create",
        after: { portCallId, ...v },
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateCargoPlan(
  cargoPlanId: string,
  input: CargoPlanInput
): Promise<ActionResult<{ id: string }>> {
  return cargoPlanAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateCargoPlanInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          cargoId: cargoPlans.cargoId,
          plannedQuantityMt: cargoPlans.plannedQuantityMt,
          actualQuantityMt: cargoPlans.actualQuantityMt,
        })
        .from(cargoPlans)
        .where(
          and(
            eq(cargoPlans.id, cargoPlanId),
            eq(cargoPlans.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Cargo plan not found.");
      }

      const [updated] = await db
        .update(cargoPlans)
        .set({
          cargoId: v.cargoId,
          plannedQuantityMt: v.plannedQuantityMt,
          actualQuantityMt: v.actualQuantityMt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cargoPlans.id, cargoPlanId),
            eq(cargoPlans.organizationId, ctx.organizationId)
          )
        )
        .returning({ id: cargoPlans.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Cargo plan not found.");
      }

      await recordAudit(ctx, {
        entityType: "CargoPlan",
        entityId: cargoPlanId,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

/**
 * Removes a cargo plan outright.
 *
 * Unlike master data (F10), a plan is a line item of its port call rather
 * than a referenced lookup, so a hard delete is correct here — the same
 * treatment Holiday gets inside a HolidayCalendar.
 */
export async function deleteCargoPlan(
  cargoPlanId: string
): Promise<ActionResult<{ id: string }>> {
  return cargoPlanAction<{ id: string }>("masterdata.write", async (ctx) => {
    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          portCallId: cargoPlans.portCallId,
          cargoId: cargoPlans.cargoId,
          plannedQuantityMt: cargoPlans.plannedQuantityMt,
        })
        .from(cargoPlans)
        .where(
          and(
            eq(cargoPlans.id, cargoPlanId),
            eq(cargoPlans.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Cargo plan not found.");
      }

      await db
        .delete(cargoPlans)
        .where(
          and(
            eq(cargoPlans.id, cargoPlanId),
            eq(cargoPlans.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "CargoPlan",
        entityId: cargoPlanId,
        action: "delete",
        before: existing[0],
      });

      return ok({ id: cargoPlanId });
    });
  });
}
