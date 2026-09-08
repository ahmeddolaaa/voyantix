"use server";

import { db } from "@/db/client";
import { vessels } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * VESSEL MASTER DATA — a canonical reference, never a prerequisite.
 * ---------------------------------------------------------------------------
 * A voyage can be created for a vessel that has no master record at all:
 * Voyage.vesselName (Phase 4) is the operational truth and is captured on
 * the voyage itself. This table exists so that vessels the company works
 * with repeatedly can be picked rather than retyped.
 *
 * Because of that split, RENAMING A VESSEL HERE DOES NOT REWRITE HISTORY.
 * A voyage recorded under a previous name keeps that name, which is what a
 * counterparty's paperwork will show. Nothing in this file may be changed
 * to cascade a rename into voyage records.
 *
 * Name is deliberately NOT unique — vessel names genuinely repeat across the
 * industry. IMO is unique within the organization when present, since that
 * is the identifier that actually distinguishes one hull from another.
 * ---------------------------------------------------------------------------
 */

export type VesselRow = {
  id: string;
  name: string;
  imo: string | null;
  dwt: number | null;
  flag: string | null;
  status: "active" | "inactive";
};

async function vesselAction<T>(
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

function optionalText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type VesselInput = {
  name: string;
  imo?: string | null;
  dwt?: string | number | null;
  flag?: string | null;
};

type ValidatedVessel = {
  name: string;
  imo: string | null;
  dwt: number | null;
  flag: string | null;
};

function validateVesselInput(
  input: VesselInput
): ActionResult<ValidatedVessel> {
  const name = (input.name ?? "").trim();
  if (name === "") {
    return fail("VALIDATION_ERROR", "Vessel name is required.");
  }
  if (name.length > 120) {
    return fail("VALIDATION_ERROR", "Vessel name must be 120 characters or fewer.");
  }

  // An IMO number is seven digits. Checking the shape catches a mistyped
  // entry now rather than when someone tries to match it against a
  // counterparty's documents months later.
  const imo = optionalText(input.imo);
  if (imo !== null && !/^\d{7}$/.test(imo)) {
    return fail("VALIDATION_ERROR", "An IMO number is seven digits.");
  }

  let dwt: number | null = null;
  const rawDwt = input.dwt;
  if (rawDwt !== null && rawDwt !== undefined && String(rawDwt).trim() !== "") {
    const parsed = Number(String(rawDwt).trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      return fail("VALIDATION_ERROR", "Deadweight must be a whole number of tonnes.");
    }
    if (parsed > 1000000) {
      return fail("VALIDATION_ERROR", "That deadweight looks too large to be right.");
    }
    dwt = parsed;
  }

  const flag = optionalText(input.flag);
  if (flag !== null && flag.length > 60) {
    return fail("VALIDATION_ERROR", "Flag must be 60 characters or fewer.");
  }

  return ok({ name, imo, dwt, flag });
}

export async function listVessels(
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<VesselRow[]>> {
  return vesselAction<VesselRow[]>("masterdata.read", async (ctx) => {
    const scope = options.includeInactive
      ? eq(vessels.organizationId, ctx.organizationId)
      : and(
          eq(vessels.organizationId, ctx.organizationId),
          eq(vessels.status, "active")
        );

    const rows = await db
      .select({
        id: vessels.id,
        name: vessels.name,
        imo: vessels.imo,
        dwt: vessels.dwt,
        flag: vessels.flag,
        status: vessels.status,
      })
      .from(vessels)
      .where(scope)
      .orderBy(asc(vessels.name));

    return ok(rows as VesselRow[]);
  });
}

export async function createVessel(
  input: VesselInput
): Promise<ActionResult<{ id: string }>> {
  return vesselAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateVesselInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(vessels)
        .values({
          organizationId: ctx.organizationId,
          name: v.name,
          imo: v.imo,
          dwt: v.dwt,
          flag: v.flag,
        })
        .returning({ id: vessels.id });

      await recordAudit(ctx, {
        entityType: "Vessel",
        entityId: created.id,
        action: "create",
        after: v,
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateVessel(
  id: string,
  input: VesselInput
): Promise<ActionResult<{ id: string }>> {
  return vesselAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateVesselInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          name: vessels.name,
          imo: vessels.imo,
          dwt: vessels.dwt,
          flag: vessels.flag,
        })
        .from(vessels)
        .where(
          and(eq(vessels.id, id), eq(vessels.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Vessel not found.");
      }

      const [updated] = await db
        .update(vessels)
        .set({
          name: v.name,
          imo: v.imo,
          dwt: v.dwt,
          flag: v.flag,
          updatedAt: new Date(),
        })
        .where(
          and(eq(vessels.id, id), eq(vessels.organizationId, ctx.organizationId))
        )
        .returning({ id: vessels.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Vessel not found.");
      }

      // Recorded so that a later question about a renamed vessel can be
      // answered from the audit trail rather than guessed at.
      await recordAudit(ctx, {
        entityType: "Vessel",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setVesselStatus(
  id: string,
  status: "active" | "inactive"
): Promise<
  ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>
> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return vesselAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "active" && status !== "inactive") {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: vessels.status })
        .from(vessels)
        .where(
          and(eq(vessels.id, id), eq(vessels.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Vessel not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      await db
        .update(vessels)
        .set({ status, updatedAt: new Date() })
        .where(
          and(eq(vessels.id, id), eq(vessels.organizationId, ctx.organizationId))
        );

      await recordAudit(ctx, {
        entityType: "Vessel",
        entityId: id,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}
