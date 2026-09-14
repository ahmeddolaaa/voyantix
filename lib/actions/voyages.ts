"use server";

import { db } from "@/db/client";
import {
  voyages,
  companyConfigurations,
  referenceSequences,
} from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * VOYAGE — the operational spine (Phase 4).
 *
 * voyageReference is GENERATED from CompanyConfiguration.voyageReferencePattern
 * using ReferenceSequence as a transactional counter, with manual override
 * allowed. Generation and the voyage insert happen inside ONE transaction so
 * two concurrent creates cannot allocate the same reference.
 *
 * vesselName is the operational truth; vesselId is an optional master link
 * (F7 — a vessel is never a prerequisite). contractId is optional too: a
 * voyage may exist before its commercial contract is attached.
 *
 * status (PO8) is purely administrative — ACTIVE | COMPLETED | CANCELLED,
 * no enforced transitions, never derived from port-call state.
 */

type VoyageStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export type VoyageRow = {
  id: string;
  voyageReference: string;
  vesselName: string;
  vesselId: string | null;
  contractId: string | null;
  status: VoyageStatus;
};

async function voyageAction<T>(
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

export type VoyageInput = {
  /** Omit or leave blank to generate from the company pattern. */
  voyageReference?: string | null;
  vesselName: string;
  vesselId?: string | null;
  contractId?: string | null;
};

type ValidatedVoyage = {
  voyageReference: string | null;
  vesselName: string;
  vesselId: string | null;
  contractId: string | null;
};

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function validateVoyageInput(
  input: VoyageInput
): ActionResult<ValidatedVoyage> {
  const vesselName = (input.vesselName ?? "").trim();
  if (vesselName === "") {
    return fail("VALIDATION_ERROR", "Vessel name is required.");
  }
  if (vesselName.length > 200) {
    return fail("VALIDATION_ERROR", "Vessel name must be 200 characters or fewer.");
  }

  const voyageReference = trimOrNull(input.voyageReference);
  if (voyageReference !== null && voyageReference.length > 120) {
    return fail("VALIDATION_ERROR", "Voyage reference must be 120 characters or fewer.");
  }

  return ok({
    voyageReference,
    vesselName,
    vesselId: trimOrNull(input.vesselId),
    contractId: trimOrNull(input.contractId),
  });
}

/**
 * Expands a company reference pattern.
 *
 * Supported placeholders, taken from the shipped default
 * ("VOY-{YY}{SEQ:4}"):
 *   {YY}      two-digit year
 *   {YYYY}    four-digit year
 *   {SEQ:n}   the allocated sequence number, zero-padded to n digits
 *   {SEQ}     the allocated sequence number, unpadded
 *
 * Anything else in the pattern is left untouched.
 */
function expandPattern(pattern: string, seq: number, year: number): string {
  return pattern
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year).slice(-2))
    .replace(/\{SEQ:(\d+)\}/g, (_m, digits: string) =>
      String(seq).padStart(Number(digits), "0")
    )
    .replace(/\{SEQ\}/g, String(seq));
}

/**
 * Allocates the next sequence value for (org, scope) and returns it.
 *
 * Runs inside the caller's transaction. The UPDATE ... RETURNING is atomic
 * and row-locking, so two concurrent voyage creates serialize here rather
 * than both reading the same value.
 */
async function allocateSequence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  scope: string
): Promise<number> {
  const updated = await tx
    .update(referenceSequences)
    .set({ nextValue: sql`${referenceSequences.nextValue} + 1` })
    .where(
      and(
        eq(referenceSequences.organizationId, organizationId),
        eq(referenceSequences.scope, scope)
      )
    )
    .returning({ nextValue: referenceSequences.nextValue });

  if (updated.length > 0) {
    // nextValue now holds the value AFTER increment, so the number this
    // call owns is one less.
    return updated[0].nextValue - 1;
  }

  // No counter yet for this scope: create it already consumed at 1.
  const [created] = await tx
    .insert(referenceSequences)
    .values({ organizationId, scope, nextValue: 2 })
    .returning({ nextValue: referenceSequences.nextValue });

  return created.nextValue - 1;
}

export async function listVoyages(): Promise<ActionResult<VoyageRow[]>> {
  return voyageAction<VoyageRow[]>("masterdata.read", async (ctx) => {
    const rows = await db
      .select({
        id: voyages.id,
        voyageReference: voyages.voyageReference,
        vesselName: voyages.vesselName,
        vesselId: voyages.vesselId,
        contractId: voyages.contractId,
        status: voyages.status,
      })
      .from(voyages)
      .where(eq(voyages.organizationId, ctx.organizationId))
      .orderBy(asc(voyages.voyageReference));

    return ok(rows as VoyageRow[]);
  });
}

export async function getVoyage(
  id: string
): Promise<ActionResult<VoyageRow>> {
  return voyageAction<VoyageRow>("masterdata.read", async (ctx) => {
    const rows = await db
      .select({
        id: voyages.id,
        voyageReference: voyages.voyageReference,
        vesselName: voyages.vesselName,
        vesselId: voyages.vesselId,
        contractId: voyages.contractId,
        status: voyages.status,
      })
      .from(voyages)
      .where(and(eq(voyages.id, id), eq(voyages.organizationId, ctx.organizationId)));

    if (rows.length === 0) {
      return fail<VoyageRow>("NOT_FOUND", "Voyage not found.");
    }
    return ok(rows[0] as VoyageRow);
  });
}

export async function createVoyage(
  input: VoyageInput
): Promise<ActionResult<{ id: string; voyageReference: string }>> {
  type Out = { id: string; voyageReference: string };

  return voyageAction<Out>("masterdata.write", async (ctx) => {
    const validated = validateVoyageInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<Out>(async () => {
      const result = await db.transaction(async (tx) => {
        let reference = v.voyageReference;

        // Generate only when the caller did not supply an override.
        if (reference === null) {
          const [config] = await tx
            .select({ pattern: companyConfigurations.voyageReferencePattern })
            .from(companyConfigurations)
            .where(eq(companyConfigurations.organizationId, ctx.organizationId));

          if (!config) {
            return fail<Out>(
              "INVALID_STATE",
              "This organization has no company configuration, so a voyage reference cannot be generated. Supply one manually."
            );
          }

          const year = new Date().getUTCFullYear();
          const seq = await allocateSequence(
            tx,
            ctx.organizationId,
            `voyage:${year}`
          );
          reference = expandPattern(config.pattern, seq, year);
        }

        const [created] = await tx
          .insert(voyages)
          .values({
            organizationId: ctx.organizationId,
            voyageReference: reference,
            vesselName: v.vesselName,
            vesselId: v.vesselId,
            contractId: v.contractId,
          })
          .returning({
            id: voyages.id,
            voyageReference: voyages.voyageReference,
          });

        return ok<Out>({
          id: created.id,
          voyageReference: created.voyageReference,
        });
      });

      if (result.ok) {
        await recordAudit(ctx, {
          entityType: "Voyage",
          entityId: result.data.id,
          action: "create",
          after: { ...v, voyageReference: result.data.voyageReference },
        });
      }

      return result;
    });
  });
}

/**
 * Updates a voyage in place. voyageReference IS editable here (the
 * architecture allows manual override), but the organization never changes.
 */
export async function updateVoyage(
  id: string,
  input: VoyageInput
): Promise<ActionResult<{ id: string }>> {
  return voyageAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateVoyageInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    if (v.voyageReference === null) {
      return fail<{ id: string }>(
        "VALIDATION_ERROR",
        "Voyage reference is required when updating a voyage."
      );
    }
    const voyageReference = v.voyageReference;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          voyageReference: voyages.voyageReference,
          vesselName: voyages.vesselName,
          vesselId: voyages.vesselId,
          contractId: voyages.contractId,
        })
        .from(voyages)
        .where(and(eq(voyages.id, id), eq(voyages.organizationId, ctx.organizationId)));

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Voyage not found.");
      }

      const [updated] = await db
        .update(voyages)
        .set({
          voyageReference,
          vesselName: v.vesselName,
          vesselId: v.vesselId,
          contractId: v.contractId,
          updatedAt: new Date(),
        })
        .where(and(eq(voyages.id, id), eq(voyages.organizationId, ctx.organizationId)))
        .returning({ id: voyages.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Voyage not found.");
      }

      await recordAudit(ctx, {
        entityType: "Voyage",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setVoyageStatus(
  id: string,
  status: VoyageStatus
): Promise<ActionResult<{ id: string; status: VoyageStatus; changed: boolean }>> {
  type Out = { id: string; status: VoyageStatus; changed: boolean };

  return voyageAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "ACTIVE" && status !== "COMPLETED" && status !== "CANCELLED") {
      return fail<Out>(
        "VALIDATION_ERROR",
        "Status must be ACTIVE, COMPLETED or CANCELLED."
      );
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: voyages.status })
        .from(voyages)
        .where(and(eq(voyages.id, id), eq(voyages.organizationId, ctx.organizationId)));

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Voyage not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      await db
        .update(voyages)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(voyages.id, id), eq(voyages.organizationId, ctx.organizationId)));

      await recordAudit(ctx, {
        entityType: "Voyage",
        entityId: id,
        action: "setStatus",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}