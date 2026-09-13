"use server";

import { db } from "@/db/client";
import {
  contracts,
  contractLaytimeTerms,
  laytimePools,
} from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * CONTRACT LAYTIME TERM — the commercial values of a fixture.
 *
 * scope = (function, portId?, cargoId?); function is a NOT NULL LOAD/DISCHARGE
 * enum (PO1), generic applicability comes from leaving port/cargo null.
 * ruleSetVersionId is NOT NULL. Numeric fields are `numeric`; withheld
 * vocabularies (allowanceUnit, despatchBasis, turnTimeTrigger,
 * commencementRule) are free text — no enum/CHECK invented (B1/B2).
 *
 * VERSIONING (F14) IS DEFERRED. The architecture freezes the PRINCIPLE
 * (editing a term that a FINALIZED statement depends on must create a new
 * term version, leaving the old row intact) but does NOT define a term-
 * version structure, and the trigger — a finalized LaytimeStatement — does
 * not exist until Phase 7. So Phase 3 does ordinary in-place CRUD here. When
 * statements arrive, update() must branch: a term with a finalized-statement
 * dependency is frozen and edited via a new version; an undependent term is
 * still edited in place. That mechanism is intentionally NOT built now
 * (roadmap PO7).
 */

type TermFunction = "LOAD" | "DISCHARGE";

export type ContractLaytimeTermRow = {
  id: string;
  contractId: string;
  function: TermFunction;
  portId: string | null;
  cargoId: string | null;
  allowance: string;
  allowanceUnit: string;
  demurrageRate: string;
  despatchRate: string | null;
  despatchBasis: string | null;
  turnTimeHours: string | null;
  turnTimeTrigger: string | null;
  commencementRule: string;
  ruleSetVersionId: string;
  poolId: string | null;
  status: "active" | "inactive";
};

async function termAction<T>(
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

export type ContractLaytimeTermInput = {
  function: TermFunction;
  portId?: string | null;
  cargoId?: string | null;
  allowance: string;
  allowanceUnit: string;
  demurrageRate: string;
  despatchRate?: string | null;
  despatchBasis?: string | null;
  turnTimeHours?: string | null;
  turnTimeTrigger?: string | null;
  commencementRule: string;
  ruleSetVersionId: string;
  poolId?: string | null;
};

type ValidatedTerm = {
  function: TermFunction;
  portId: string | null;
  cargoId: string | null;
  allowance: string;
  allowanceUnit: string;
  demurrageRate: string;
  despatchRate: string | null;
  despatchBasis: string | null;
  turnTimeHours: string | null;
  turnTimeTrigger: string | null;
  commencementRule: string;
  ruleSetVersionId: string;
  poolId: string | null;
};

const NUMERIC = /^-?\d+(\.\d+)?$/;

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function validateTermInput(
  input: ContractLaytimeTermInput
): ActionResult<ValidatedTerm> {
  if (input.function !== "LOAD" && input.function !== "DISCHARGE") {
    return fail("VALIDATION_ERROR", "Function must be LOAD or DISCHARGE.");
  }

  const allowance = (input.allowance ?? "").trim();
  if (!NUMERIC.test(allowance)) {
    return fail("VALIDATION_ERROR", "Allowance must be a number.");
  }
  const demurrageRate = (input.demurrageRate ?? "").trim();
  if (!NUMERIC.test(demurrageRate)) {
    return fail("VALIDATION_ERROR", "Demurrage rate must be a number.");
  }

  const despatchRate = trimOrNull(input.despatchRate);
  if (despatchRate !== null && !NUMERIC.test(despatchRate)) {
    return fail("VALIDATION_ERROR", "Despatch rate must be a number.");
  }
  const turnTimeHours = trimOrNull(input.turnTimeHours);
  if (turnTimeHours !== null && !NUMERIC.test(turnTimeHours)) {
    return fail("VALIDATION_ERROR", "Turn time hours must be a number.");
  }

  const allowanceUnit = (input.allowanceUnit ?? "").trim();
  if (allowanceUnit === "") {
    return fail("VALIDATION_ERROR", "Allowance unit is required.");
  }
  const commencementRule = (input.commencementRule ?? "").trim();
  if (commencementRule === "") {
    return fail("VALIDATION_ERROR", "Commencement rule is required.");
  }

  const ruleSetVersionId = (input.ruleSetVersionId ?? "").trim();
  if (ruleSetVersionId === "") {
    return fail("VALIDATION_ERROR", "A rule set version is required.");
  }

  return ok({
    function: input.function,
    portId: trimOrNull(input.portId),
    cargoId: trimOrNull(input.cargoId),
    allowance,
    allowanceUnit,
    demurrageRate,
    despatchRate,
    despatchBasis: trimOrNull(input.despatchBasis),
    turnTimeHours,
    turnTimeTrigger: trimOrNull(input.turnTimeTrigger),
    commencementRule,
    ruleSetVersionId,
    poolId: trimOrNull(input.poolId),
  });
}

async function contractInOrg(
  contractId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(
      and(
        eq(contracts.id, contractId),
        eq(contracts.organizationId, organizationId)
      )
    );
  return rows.length > 0;
}

/** A referenced pool must belong to the SAME contract as the term (and, by
 *  the composite FK, the same org). Returns true when poolId is null or the
 *  pool is a valid pool of this contract. */
async function poolBelongsToContract(
  poolId: string,
  contractId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: laytimePools.id })
    .from(laytimePools)
    .where(
      and(
        eq(laytimePools.id, poolId),
        eq(laytimePools.contractId, contractId),
        eq(laytimePools.organizationId, organizationId)
      )
    );
  return rows.length > 0;
}

export async function listContractLaytimeTerms(
  contractId: string,
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<ContractLaytimeTermRow[]>> {
  return termAction<ContractLaytimeTermRow[]>("masterdata.read", async (ctx) => {
    if (!(await contractInOrg(contractId, ctx.organizationId))) {
      return fail<ContractLaytimeTermRow[]>("NOT_FOUND", "Contract not found.");
    }

    const base = and(
      eq(contractLaytimeTerms.contractId, contractId),
      eq(contractLaytimeTerms.organizationId, ctx.organizationId)
    );
    const scope = options.includeInactive
      ? base
      : and(base, eq(contractLaytimeTerms.status, "active"));

    const rows = await db
      .select()
      .from(contractLaytimeTerms)
      .where(scope)
      .orderBy(
        asc(contractLaytimeTerms.function),
        asc(contractLaytimeTerms.createdAt)
      );

    return ok(rows as unknown as ContractLaytimeTermRow[]);
  });
}

export async function createContractLaytimeTerm(
  contractId: string,
  input: ContractLaytimeTermInput
): Promise<ActionResult<{ id: string }>> {
  return termAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateTermInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    if (!(await contractInOrg(contractId, ctx.organizationId))) {
      return fail<{ id: string }>("NOT_FOUND", "Contract not found.");
    }

    // A pool, if given, must belong to THIS contract (not just the org).
    if (
      v.poolId !== null &&
      !(await poolBelongsToContract(v.poolId, contractId, ctx.organizationId))
    ) {
      return fail<{ id: string }>(
        "NOT_FOUND",
        "The selected pool does not belong to this contract."
      );
    }

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(contractLaytimeTerms)
        .values({
          organizationId: ctx.organizationId,
          contractId,
          function: v.function,
          portId: v.portId,
          cargoId: v.cargoId,
          allowance: v.allowance,
          allowanceUnit: v.allowanceUnit,
          demurrageRate: v.demurrageRate,
          despatchRate: v.despatchRate,
          despatchBasis: v.despatchBasis,
          turnTimeHours: v.turnTimeHours,
          turnTimeTrigger: v.turnTimeTrigger,
          commencementRule: v.commencementRule,
          ruleSetVersionId: v.ruleSetVersionId,
          poolId: v.poolId,
        })
        .returning({ id: contractLaytimeTerms.id });

      await recordAudit(ctx, {
        entityType: "ContractLaytimeTerm",
        entityId: created.id,
        action: "create",
        after: { contractId, ...v },
      });

      return ok({ id: created.id });
    });
  });
}

/**
 * Updates a term IN PLACE. Its contract is fixed (the payload has no
 * contractId), and organization ownership never changes.
 *
 * F14 DEFERRAL: when the statement phase exists, this path must first check
 * whether the term is depended on by a FINALIZED statement and, if so, create
 * a new term version instead of mutating the row. That branch is not built
 * now — no statements exist yet (roadmap PO7).
 */
export async function updateContractLaytimeTerm(
  termId: string,
  input: ContractLaytimeTermInput
): Promise<ActionResult<{ id: string }>> {
  return termAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateTermInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          contractId: contractLaytimeTerms.contractId,
          function: contractLaytimeTerms.function,
          allowance: contractLaytimeTerms.allowance,
        })
        .from(contractLaytimeTerms)
        .where(
          and(
            eq(contractLaytimeTerms.id, termId),
            eq(contractLaytimeTerms.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Term not found.");
      }
      const contractId = existing[0].contractId;

      // A pool, if given, must belong to the term's own contract.
      if (
        v.poolId !== null &&
        !(await poolBelongsToContract(v.poolId, contractId, ctx.organizationId))
      ) {
        return fail<{ id: string }>(
          "NOT_FOUND",
          "The selected pool does not belong to this contract."
        );
      }

      const [updated] = await db
        .update(contractLaytimeTerms)
        .set({
          function: v.function,
          portId: v.portId,
          cargoId: v.cargoId,
          allowance: v.allowance,
          allowanceUnit: v.allowanceUnit,
          demurrageRate: v.demurrageRate,
          despatchRate: v.despatchRate,
          despatchBasis: v.despatchBasis,
          turnTimeHours: v.turnTimeHours,
          turnTimeTrigger: v.turnTimeTrigger,
          commencementRule: v.commencementRule,
          ruleSetVersionId: v.ruleSetVersionId,
          poolId: v.poolId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(contractLaytimeTerms.id, termId),
            eq(contractLaytimeTerms.organizationId, ctx.organizationId)
          )
        )
        .returning({ id: contractLaytimeTerms.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Term not found.");
      }

      await recordAudit(ctx, {
        entityType: "ContractLaytimeTerm",
        entityId: termId,
        action: "update",
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setContractLaytimeTermStatus(
  termId: string,
  status: "active" | "inactive"
): Promise<ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return termAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "active" && status !== "inactive") {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: contractLaytimeTerms.status })
        .from(contractLaytimeTerms)
        .where(
          and(
            eq(contractLaytimeTerms.id, termId),
            eq(contractLaytimeTerms.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Term not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id: termId, status, changed: false });
      }

      await db
        .update(contractLaytimeTerms)
        .set({ status, updatedAt: new Date() })
        .where(
          and(
            eq(contractLaytimeTerms.id, termId),
            eq(contractLaytimeTerms.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "ContractLaytimeTerm",
        entityId: termId,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id: termId, status, changed: true });
    });
  });
}