"use server";

import { db } from "@/db/client";
import { shiftPerformances, voyagePortCalls } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * SHIFT PERFORMANCE — how much cargo moved on a given operational day.
 *
 * F24, frozen: this NEVER affects laytime countability. Phase 6 reads it
 * only to know whether work occurred inside a window — the distinction EIU
 * turns on — and tonnage never moves the clock. There is deliberately no
 * countability flag, no commencement hint and no event semantic here, and
 * none should be added: the moment throughput could shorten laytime, the
 * calculation would answer to operational data entry rather than to the
 * charterparty.
 *
 * shiftDate is a calendar date, not an instant. A shift belongs to an
 * operational day at the port, and which day that is gets read in the port
 * call's effectiveTimezone (F18/F28) — never in UTC.
 */

export type ShiftPerformanceRow = {
  id: string;
  portCallId: string;
  facilityId: string | null;
  cargoId: string;
  shiftDate: string;
  crane: string | null;
  operationType: string | null;
  quantityMt: string;
  recordedByUserId: string;
};

async function shiftAction<T>(
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

export type ShiftPerformanceInput = {
  facilityId?: string | null;
  cargoId: string;
  /** ISO date, e.g. "2026-03-15". */
  shiftDate: string;
  crane?: string | null;
  operationType?: string | null;
  quantityMt: string;
};

type ValidatedShift = {
  facilityId: string | null;
  cargoId: string;
  shiftDate: string;
  crane: string | null;
  operationType: string | null;
  quantityMt: string;
};

const NUMERIC = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function validateShiftInput(
  input: ShiftPerformanceInput
): ActionResult<ValidatedShift> {
  const cargoId = (input.cargoId ?? "").trim();
  if (cargoId === "") {
    return fail("VALIDATION_ERROR", "A cargo is required.");
  }

  const shiftDate = (input.shiftDate ?? "").trim();
  if (!ISO_DATE.test(shiftDate)) {
    return fail("VALIDATION_ERROR", "A shift date is required, as YYYY-MM-DD.");
  }

  const quantityMt = (input.quantityMt ?? "").trim();
  if (!NUMERIC.test(quantityMt)) {
    return fail("VALIDATION_ERROR", "Quantity must be a number.");
  }
  if (Number(quantityMt) < 0) {
    return fail("VALIDATION_ERROR", "Quantity cannot be negative.");
  }

  return ok({
    facilityId: trimOrNull(input.facilityId),
    cargoId,
    shiftDate,
    crane: trimOrNull(input.crane),
    operationType: trimOrNull(input.operationType),
    quantityMt,
  });
}

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

const shiftColumns = {
  id: shiftPerformances.id,
  portCallId: shiftPerformances.portCallId,
  facilityId: shiftPerformances.facilityId,
  cargoId: shiftPerformances.cargoId,
  shiftDate: shiftPerformances.shiftDate,
  crane: shiftPerformances.crane,
  operationType: shiftPerformances.operationType,
  quantityMt: shiftPerformances.quantityMt,
  recordedByUserId: shiftPerformances.recordedByUserId,
};

export async function listShiftPerformances(
  portCallId: string
): Promise<ActionResult<ShiftPerformanceRow[]>> {
  return shiftAction<ShiftPerformanceRow[]>("masterdata.read", async (ctx) => {
    if (!(await portCallInOrg(portCallId, ctx.organizationId))) {
      return fail<ShiftPerformanceRow[]>("NOT_FOUND", "Port call not found.");
    }

    const rows = await db
      .select(shiftColumns)
      .from(shiftPerformances)
      .where(
        and(
          eq(shiftPerformances.portCallId, portCallId),
          eq(shiftPerformances.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(shiftPerformances.shiftDate), asc(shiftPerformances.createdAt));

    return ok(rows as ShiftPerformanceRow[]);
  });
}

export async function createShiftPerformance(
  portCallId: string,
  input: ShiftPerformanceInput
): Promise<ActionResult<{ id: string }>> {
  return shiftAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateShiftInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    if (!(await portCallInOrg(portCallId, ctx.organizationId))) {
      return fail<{ id: string }>("NOT_FOUND", "Port call not found.");
    }

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(shiftPerformances)
        .values({
          organizationId: ctx.organizationId,
          portCallId,
          facilityId: v.facilityId,
          cargoId: v.cargoId,
          shiftDate: v.shiftDate,
          crane: v.crane,
          operationType: v.operationType,
          quantityMt: v.quantityMt,
          recordedByUserId: ctx.userId,
        })
        .returning({ id: shiftPerformances.id });

      await recordAudit(ctx, {
        entityType: "ShiftPerformance",
        entityId: created.id,
        action: "create",
        after: { portCallId, ...v },
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateShiftPerformance(
  shiftId: string,
  input: ShiftPerformanceInput
): Promise<ActionResult<{ id: string }>> {
  return shiftAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateShiftInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          facilityId: shiftPerformances.facilityId,
          cargoId: shiftPerformances.cargoId,
          shiftDate: shiftPerformances.shiftDate,
          quantityMt: shiftPerformances.quantityMt,
        })
        .from(shiftPerformances)
        .where(
          and(
            eq(shiftPerformances.id, shiftId),
            eq(shiftPerformances.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Shift record not found.");
      }

      const [updated] = await db
        .update(shiftPerformances)
        .set({
          facilityId: v.facilityId,
          cargoId: v.cargoId,
          shiftDate: v.shiftDate,
          crane: v.crane,
          operationType: v.operationType,
          quantityMt: v.quantityMt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(shiftPerformances.id, shiftId),
            eq(shiftPerformances.organizationId, ctx.organizationId)
          )
        )
        .returning({ id: shiftPerformances.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Shift record not found.");
      }

      await recordAudit(ctx, {
        entityType: "ShiftPerformance",
        entityId: shiftId,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function deleteShiftPerformance(
  shiftId: string
): Promise<ActionResult<{ id: string }>> {
  return shiftAction<{ id: string }>("masterdata.write", async (ctx) => {
    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          portCallId: shiftPerformances.portCallId,
          cargoId: shiftPerformances.cargoId,
          shiftDate: shiftPerformances.shiftDate,
          quantityMt: shiftPerformances.quantityMt,
        })
        .from(shiftPerformances)
        .where(
          and(
            eq(shiftPerformances.id, shiftId),
            eq(shiftPerformances.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Shift record not found.");
      }

      await db
        .delete(shiftPerformances)
        .where(
          and(
            eq(shiftPerformances.id, shiftId),
            eq(shiftPerformances.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "ShiftPerformance",
        entityId: shiftId,
        action: "delete",
        before: existing[0],
      });

      return ok({ id: shiftId });
    });
  });
}
