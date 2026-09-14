"use server";

import { db } from "@/db/client";
import { voyagePortCalls, voyages, ports } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * VOYAGE PORT CALL — one visit to one port within a voyage (Phase 4).
 *
 * effectiveTimezone is SNAPSHOTTED here, at creation, and never recomputed
 * afterwards (F28): it resolves from Port.defaultTimezone and falls back to
 * "UTC" only when the port carries none. CompanyConfiguration.defaultTimezone
 * is application/display-only and deliberately plays no part. If an admin
 * later corrects a port's timezone, existing port calls keep the value they
 * were created with, so historical calculations cannot silently shift.
 *
 * sequence (PO10) is the intended visiting order, never a timestamp. It is
 * unique within a voyage at the database level, gaps are allowed, and the
 * next value is allocated inside the same transaction as the insert.
 *
 * contractLaytimeTermId (PO11) is NOT resolved here. Cargo context lives on
 * CargoPlan, which does not exist when a port call is created, so resolution
 * is a separate explicit action — never an automatic side effect.
 */

type PortCallFunction = "LOAD" | "DISCHARGE";
type PortCallStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export type VoyagePortCallRow = {
  id: string;
  voyageId: string;
  portId: string;
  facilityId: string | null;
  function: PortCallFunction;
  sequence: number;
  status: PortCallStatus;
  effectiveTimezone: string;
  contractLaytimeTermId: string | null;
};

async function portCallAction<T>(
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

export type VoyagePortCallInput = {
  portId: string;
  facilityId?: string | null;
  function: PortCallFunction;
  /** Omit to append after the voyage's current highest sequence. */
  sequence?: number | null;
};

type ValidatedPortCall = {
  portId: string;
  facilityId: string | null;
  function: PortCallFunction;
  sequence: number | null;
};

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function validatePortCallInput(
  input: VoyagePortCallInput
): ActionResult<ValidatedPortCall> {
  const portId = (input.portId ?? "").trim();
  if (portId === "") {
    return fail("VALIDATION_ERROR", "A port is required.");
  }

  if (input.function !== "LOAD" && input.function !== "DISCHARGE") {
    return fail("VALIDATION_ERROR", "Function must be LOAD or DISCHARGE.");
  }

  let sequence: number | null = null;
  if (input.sequence !== undefined && input.sequence !== null) {
    if (!Number.isInteger(input.sequence)) {
      return fail("VALIDATION_ERROR", "Sequence must be a whole number.");
    }
    if (input.sequence < 1) {
      return fail("VALIDATION_ERROR", "Sequence must be 1 or greater.");
    }
    sequence = input.sequence;
  }

  return ok({
    portId,
    facilityId: trimOrNull(input.facilityId),
    function: input.function,
    sequence,
  });
}

/** Confirms the voyage exists inside the caller's organization. */
async function voyageInOrg(
  voyageId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: voyages.id })
    .from(voyages)
    .where(
      and(eq(voyages.id, voyageId), eq(voyages.organizationId, organizationId))
    );
  return rows.length > 0;
}

export async function listVoyagePortCalls(
  voyageId: string
): Promise<ActionResult<VoyagePortCallRow[]>> {
  return portCallAction<VoyagePortCallRow[]>("masterdata.read", async (ctx) => {
    if (!(await voyageInOrg(voyageId, ctx.organizationId))) {
      return fail<VoyagePortCallRow[]>("NOT_FOUND", "Voyage not found.");
    }

    const rows = await db
      .select({
        id: voyagePortCalls.id,
        voyageId: voyagePortCalls.voyageId,
        portId: voyagePortCalls.portId,
        facilityId: voyagePortCalls.facilityId,
        function: voyagePortCalls.function,
        sequence: voyagePortCalls.sequence,
        status: voyagePortCalls.status,
        effectiveTimezone: voyagePortCalls.effectiveTimezone,
        contractLaytimeTermId: voyagePortCalls.contractLaytimeTermId,
      })
      .from(voyagePortCalls)
      .where(
        and(
          eq(voyagePortCalls.voyageId, voyageId),
          eq(voyagePortCalls.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(voyagePortCalls.sequence));

    return ok(rows as VoyagePortCallRow[]);
  });
}

export async function createVoyagePortCall(
  voyageId: string,
  input: VoyagePortCallInput
): Promise<ActionResult<{ id: string; sequence: number; effectiveTimezone: string }>> {
  type Out = { id: string; sequence: number; effectiveTimezone: string };

  return portCallAction<Out>("masterdata.write", async (ctx) => {
    const validated = validatePortCallInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    if (!(await voyageInOrg(voyageId, ctx.organizationId))) {
      return fail<Out>("NOT_FOUND", "Voyage not found.");
    }

    return withDatabaseErrors<Out>(async () => {
      const result = await db.transaction(async (tx) => {
        // F28: resolve the effective timezone from the PORT, falling back to
        // UTC. Company configuration is never consulted.
        const [port] = await tx
          .select({ defaultTimezone: ports.defaultTimezone })
          .from(ports)
          .where(
            and(
              eq(ports.id, v.portId),
              eq(ports.organizationId, ctx.organizationId)
            )
          );

        if (!port) {
          return fail<Out>("NOT_FOUND", "The selected port could not be found.");
        }

        const effectiveTimezone =
          (port.defaultTimezone ?? "").trim() === ""
            ? "UTC"
            : port.defaultTimezone.trim();

        // PO10: allocate the next sequence within this voyage when the caller
        // did not choose one. Reading MAX inside the transaction keeps two
        // concurrent appends from picking the same number; if they still race,
        // the unique index rejects the loser rather than silently reordering.
        let sequence = v.sequence;
        if (sequence === null) {
          const [max] = await tx
            .select({
              value: sql<number | null>`max(${voyagePortCalls.sequence})`,
            })
            .from(voyagePortCalls)
            .where(eq(voyagePortCalls.voyageId, voyageId));
          sequence = (max?.value ?? 0) + 1;
        }

        const [created] = await tx
          .insert(voyagePortCalls)
          .values({
            organizationId: ctx.organizationId,
            voyageId,
            portId: v.portId,
            facilityId: v.facilityId,
            function: v.function,
            sequence,
            effectiveTimezone,
          })
          .returning({
            id: voyagePortCalls.id,
            sequence: voyagePortCalls.sequence,
            effectiveTimezone: voyagePortCalls.effectiveTimezone,
          });

        return ok<Out>({
          id: created.id,
          sequence: created.sequence,
          effectiveTimezone: created.effectiveTimezone,
        });
      });

      if (result.ok) {
        await recordAudit(ctx, {
          entityType: "VoyagePortCall",
          entityId: result.data.id,
          action: "create",
          after: {
            voyageId,
            ...v,
            sequence: result.data.sequence,
            effectiveTimezone: result.data.effectiveTimezone,
          },
        });
      }

      return result;
    });
  });
}

/**
 * Updates a port call in place.
 *
 * effectiveTimezone is NOT recomputed here even when the port changes: the
 * snapshot belongs to the moment of creation (F28). A port call pointed at
 * the wrong port is corrected by deleting it and creating it again, so the
 * timezone the engine will use is always one a person chose deliberately.
 *
 * contractLaytimeTermId is not touched either — PO11 keeps resolution and
 * override in their own explicit actions.
 */
export async function updateVoyagePortCall(
  portCallId: string,
  input: VoyagePortCallInput
): Promise<ActionResult<{ id: string }>> {
  return portCallAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validatePortCallInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          portId: voyagePortCalls.portId,
          facilityId: voyagePortCalls.facilityId,
          function: voyagePortCalls.function,
          sequence: voyagePortCalls.sequence,
        })
        .from(voyagePortCalls)
        .where(
          and(
            eq(voyagePortCalls.id, portCallId),
            eq(voyagePortCalls.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Port call not found.");
      }

      const [updated] = await db
        .update(voyagePortCalls)
        .set({
          portId: v.portId,
          facilityId: v.facilityId,
          function: v.function,
          sequence: v.sequence ?? existing[0].sequence,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(voyagePortCalls.id, portCallId),
            eq(voyagePortCalls.organizationId, ctx.organizationId)
          )
        )
        .returning({ id: voyagePortCalls.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Port call not found.");
      }

      await recordAudit(ctx, {
        entityType: "VoyagePortCall",
        entityId: portCallId,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setVoyagePortCallStatus(
  portCallId: string,
  status: PortCallStatus
): Promise<ActionResult<{ id: string; status: PortCallStatus; changed: boolean }>> {
  type Out = { id: string; status: PortCallStatus; changed: boolean };

  return portCallAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "ACTIVE" && status !== "COMPLETED" && status !== "CANCELLED") {
      return fail<Out>(
        "VALIDATION_ERROR",
        "Status must be ACTIVE, COMPLETED or CANCELLED."
      );
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: voyagePortCalls.status })
        .from(voyagePortCalls)
        .where(
          and(
            eq(voyagePortCalls.id, portCallId),
            eq(voyagePortCalls.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Port call not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id: portCallId, status, changed: false });
      }

      await db
        .update(voyagePortCalls)
        .set({ status, updatedAt: new Date() })
        .where(
          and(
            eq(voyagePortCalls.id, portCallId),
            eq(voyagePortCalls.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "VoyagePortCall",
        entityId: portCallId,
        action: "setStatus",
        before: { status: current },
        after: { status },
      });

      return ok({ id: portCallId, status, changed: true });
    });
  });
}
