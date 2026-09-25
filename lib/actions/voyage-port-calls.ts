"use server";

import { db } from "@/db/client";
import {
  voyagePortCalls,
  voyages,
  ports,
  cargoPlans,
  contractLaytimeTerms,
} from "@/db/schema";
import {
  resolveApplicableTerm,
  TermAmbiguityException,
} from "@/lib/commercial/applicability-resolver";
import { and, asc, eq, sql } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";
import { LAYTIME_END_EVENTS, isOneOf } from "@/lib/laytime/term-vocabulary";

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
  /** Per-vessel laytime-end override; null = the term's default. */
  laytimeEndOverride: string | null;
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
        laytimeEndOverride: voyagePortCalls.laytimeEndOverride,
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

// ---------------------------------------------------------------------------
// PO11 — COMMERCIAL TERM RESOLUTION
//
// Resolution is never automatic. It does not run at port-call creation (the
// cargo is not known yet), and it does not re-run when the contract, port,
// function or cargo later change. A stored term therefore always reflects a
// decision someone made deliberately, which is what keeps a finalized
// statement reproducible (F20) and stops an edit elsewhere from silently
// rewriting commercial intent.
//
// The seven states the caller must be able to tell apart:
//   1. not yet resolved          contractLaytimeTermId is null, never resolved
//   2. insufficient cargo context INSUFFICIENT_CARGO_CONTEXT
//   3. multiple cargo contexts    MULTIPLE_CARGO_CONTEXTS
//   4. zero matching terms        ok, with termId null
//   5. ambiguous matching terms   AMBIGUOUS_TERM
//   6. successfully resolved      ok, with a termId, audit action "resolve"
//   7. manually overridden        ok, with a termId, audit action "override"
//
// States 1 and 4 both leave the column null, so they are NOT collapsed: a
// zero match returns ok (the resolver ran and found nothing), while an
// unresolved call simply never ran it.
// ---------------------------------------------------------------------------

/** Everything resolution needs about the port call, fetched in one go. */
async function loadResolutionContext(
  portCallId: string,
  organizationId: string
) {
  const [row] = await db
    .select({
      portId: voyagePortCalls.portId,
      function: voyagePortCalls.function,
      contractId: voyages.contractId,
    })
    .from(voyagePortCalls)
    .innerJoin(
      voyages,
      and(
        eq(voyagePortCalls.voyageId, voyages.id),
        eq(voyages.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(voyagePortCalls.id, portCallId),
        eq(voyagePortCalls.organizationId, organizationId)
      )
    );
  return row ?? null;
}

export async function resolveContractLaytimeTerm(
  portCallId: string
): Promise<ActionResult<{ id: string; contractLaytimeTermId: string | null }>> {
  type Out = { id: string; contractLaytimeTermId: string | null };

  return portCallAction<Out>("masterdata.write", async (ctx) => {
    const pc = await loadResolutionContext(portCallId, ctx.organizationId);
    if (!pc) {
      return fail<Out>("NOT_FOUND", "Port call not found.");
    }

    // Scope: only terms of the voyage's OWN contract are candidates. Without
    // a contract there is nothing to resolve against, and guessing from the
    // organization's other contracts would be arbitrary.
    if (pc.contractId === null) {
      return fail<Out>(
        "CONTRACT_REQUIRED",
        "This voyage has no contract, so a laytime term cannot be resolved. Attach a contract to the voyage first."
      );
    }

    // Cargo context comes from the port call's cargo plans.
    const plans = await db
      .select({ cargoId: cargoPlans.cargoId })
      .from(cargoPlans)
      .where(
        and(
          eq(cargoPlans.portCallId, portCallId),
          eq(cargoPlans.organizationId, ctx.organizationId)
        )
      );

    if (plans.length === 0) {
      return fail<Out>(
        "INSUFFICIENT_CARGO_CONTEXT",
        "This port call has no cargo plan yet, so there is no cargo to resolve a term against."
      );
    }
    if (plans.length > 1) {
      return fail<Out>(
        "MULTIPLE_CARGO_CONTEXTS",
        "This port call has more than one cargo plan. A single laytime term cannot be resolved automatically — set it manually instead."
      );
    }

    const candidates = await db
      .select({
        id: contractLaytimeTerms.id,
        function: contractLaytimeTerms.function,
        portId: contractLaytimeTerms.portId,
        cargoId: contractLaytimeTerms.cargoId,
      })
      .from(contractLaytimeTerms)
      .where(
        and(
          eq(contractLaytimeTerms.contractId, pc.contractId),
          eq(contractLaytimeTerms.organizationId, ctx.organizationId),
          eq(contractLaytimeTerms.status, "active")
        )
      );

    let resolved: { id: string } | null;
    try {
      resolved = resolveApplicableTerm(
        {
          function: pc.function,
          portId: pc.portId,
          cargoId: plans[0].cargoId,
        },
        candidates
      );
    } catch (e) {
      if (e instanceof TermAmbiguityException) {
        // The stored value is deliberately left untouched.
        return fail<Out>(
          "AMBIGUOUS_TERM",
          `${e.candidateCount} laytime terms apply to this port call and none is more specific than the rest. Narrow their scope, or set the term manually.`
        );
      }
      throw e;
    }

    return withDatabaseErrors<Out>(async () => {
      const termId = resolved?.id ?? null;

      await db
        .update(voyagePortCalls)
        .set({ contractLaytimeTermId: termId, updatedAt: new Date() })
        .where(
          and(
            eq(voyagePortCalls.id, portCallId),
            eq(voyagePortCalls.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "VoyagePortCall",
        entityId: portCallId,
        action: "resolve",
        after: { contractLaytimeTermId: termId, cargoId: plans[0].cargoId },
      });

      return ok({ id: portCallId, contractLaytimeTermId: termId });
    });
  });
}

/**
 * Sets the term by hand, bypassing the resolver entirely.
 *
 * The column is the same one resolution writes; the difference lives in the
 * audit log ("override" rather than "resolve"), so the history shows whether
 * a term was derived or chosen. Passing null clears the term.
 *
 * The term must belong to the voyage's own contract — the same scope rule
 * resolution follows. An override is a commercial judgement, not a licence
 * to attach a term from an unrelated fixture.
 */
export async function overrideContractLaytimeTerm(
  portCallId: string,
  contractLaytimeTermId: string | null
): Promise<ActionResult<{ id: string; contractLaytimeTermId: string | null }>> {
  type Out = { id: string; contractLaytimeTermId: string | null };

  return portCallAction<Out>("masterdata.write", async (ctx) => {
    const pc = await loadResolutionContext(portCallId, ctx.organizationId);
    if (!pc) {
      return fail<Out>("NOT_FOUND", "Port call not found.");
    }

    const termId = (contractLaytimeTermId ?? "").trim() || null;

    if (termId !== null) {
      if (pc.contractId === null) {
        return fail<Out>(
          "CONTRACT_REQUIRED",
          "This voyage has no contract, so a laytime term cannot be attached. Attach a contract to the voyage first."
        );
      }

      const [term] = await db
        .select({ id: contractLaytimeTerms.id })
        .from(contractLaytimeTerms)
        .where(
          and(
            eq(contractLaytimeTerms.id, termId),
            eq(contractLaytimeTerms.contractId, pc.contractId),
            eq(contractLaytimeTerms.organizationId, ctx.organizationId)
          )
        );

      if (!term) {
        return fail<Out>(
          "NOT_FOUND",
          "That laytime term does not belong to this voyage's contract."
        );
      }
    }

    return withDatabaseErrors<Out>(async () => {
      await db
        .update(voyagePortCalls)
        .set({ contractLaytimeTermId: termId, updatedAt: new Date() })
        .where(
          and(
            eq(voyagePortCalls.id, portCallId),
            eq(voyagePortCalls.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "VoyagePortCall",
        entityId: portCallId,
        action: "override",
        after: { contractLaytimeTermId: termId },
      });

      return ok({ id: portCallId, contractLaytimeTermId: termId });
    });
  });
}

/**
 * Sets (or clears, with null) the laytime-end override for ONE port call —
 * e.g. the documents took very long to be signed on this vessel, so laytime
 * ends at "documents on board" instead of the term's usual end. A commercial
 * judgement that changes the claim: contract.write, audited with before/after.
 * The caller recalculates afterwards; this action never computes.
 */
export async function setPortCallLaytimeEnd(
  portCallId: string,
  laytimeEndEvent: string | null
): Promise<ActionResult<{ id: string; laytimeEndOverride: string | null }>> {
  type Out = { id: string; laytimeEndOverride: string | null };

  return portCallAction<Out>("contract.write", async (ctx) => {
    const value = (laytimeEndEvent ?? "").trim() || null;
    if (value !== null && !isOneOf(LAYTIME_END_EVENTS, value)) {
      return fail<Out>("VALIDATION_ERROR", "Choose the event laytime ends at.");
    }

    const [pc] = await db
      .select({ id: voyagePortCalls.id, before: voyagePortCalls.laytimeEndOverride })
      .from(voyagePortCalls)
      .where(
        and(
          eq(voyagePortCalls.id, portCallId),
          eq(voyagePortCalls.organizationId, ctx.organizationId)
        )
      );
    if (!pc) return fail<Out>("NOT_FOUND", "Port call not found.");

    return withDatabaseErrors<Out>(async () => {
      await db
        .update(voyagePortCalls)
        .set({ laytimeEndOverride: value, updatedAt: new Date() })
        .where(
          and(
            eq(voyagePortCalls.id, portCallId),
            eq(voyagePortCalls.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "VoyagePortCall",
        entityId: portCallId,
        action: "set_laytime_end",
        before: { laytimeEndOverride: pc.before },
        after: { laytimeEndOverride: value },
      });

      return ok({ id: portCallId, laytimeEndOverride: value });
    });
  });
}
