"use server";

import { db } from "@/db/client";
import {
  contracts,
  contractLaytimeTerms,
  laytimePools,
  voyagePortCalls,
  laytimeStatements,
  laytimeCalculations,
  contractStoppageRules,
} from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";
import {
  COMMENCEMENT_EVENTS,
  COMMENCEMENT_TIME_RULES,
  LAYTIME_END_EVENTS,
  ALLOWANCE_UNITS,
  DESPATCH_BASES,
  isOneOf,
} from "@/lib/laytime/term-vocabulary";

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
  allowanceBasis: string;
  allowance: string;
  allowanceUnit: string;
  allowanceRate: string | null;
  demurrageRate: string;
  despatchRate: string | null;
  despatchBasis: string | null;
  turnTimeHours: string | null;
  turnTimeTrigger: string | null;
  commencementRule: string;
  commencementTimeRule: string;
  onceOnDemurrage: boolean;
  laytimeEndEvent: string;
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
  /** "FIXED" (default) or "RATE". */
  allowanceBasis?: string | null;
  allowance: string;
  allowanceUnit: string;
  /** MT-per-day rate; required when allowanceBasis = RATE. */
  allowanceRate?: string | null;
  demurrageRate: string;
  despatchRate?: string | null;
  despatchBasis?: string | null;
  turnTimeHours?: string | null;
  turnTimeTrigger?: string | null;
  commencementRule: string;
  /** "AT_EVENT" (default) or "MORNING_NOR_1400". */
  commencementTimeRule?: string | null;
  /** "Once on demurrage, always on demurrage" clause (default false). */
  onceOnDemurrage?: boolean | null;
  /** Default laytime-end event (OPS_COMPLETED | LASHING_COMPLETED | DOCUMENTS_ON_BOARD). */
  laytimeEndEvent?: string | null;
  ruleSetVersionId: string;
  poolId?: string | null;
};

type ValidatedTerm = {
  function: TermFunction;
  portId: string | null;
  cargoId: string | null;
  allowanceBasis: string;
  allowance: string;
  allowanceUnit: string;
  allowanceRate: string | null;
  demurrageRate: string;
  despatchRate: string | null;
  despatchBasis: string | null;
  turnTimeHours: string | null;
  turnTimeTrigger: string | null;
  commencementRule: string;
  commencementTimeRule: string;
  onceOnDemurrage: boolean;
  laytimeEndEvent: string;
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

  const allowanceBasis = input.allowanceBasis === "RATE" ? "RATE" : "FIXED";

  // A RATE term is settled from actual cargo quantity ÷ rate, so it needs a
  // positive rate and leaves the fixed allowance neutral; a FIXED term needs a
  // numeric allowance in a defined unit, exactly as before.
  let allowance: string;
  let allowanceUnit: string;
  let allowanceRate: string | null;
  if (allowanceBasis === "RATE") {
    allowanceRate = (input.allowanceRate ?? "").trim();
    if (!NUMERIC.test(allowanceRate) || Number(allowanceRate) <= 0) {
      return fail("VALIDATION_ERROR", "Rate must be a positive number (MT per day).");
    }
    allowance = "0";
    allowanceUnit = "days";
  } else {
    allowance = (input.allowance ?? "").trim();
    if (!NUMERIC.test(allowance)) {
      return fail("VALIDATION_ERROR", "Allowance must be a number.");
    }
    allowanceUnit = (input.allowanceUnit ?? "").trim();
    if (!isOneOf(ALLOWANCE_UNITS, allowanceUnit)) {
      return fail("VALIDATION_ERROR", "Allowance unit must be days or hours.");
    }
    allowanceRate = null;
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

  // Turn time: a duration needs a recognised trigger event; no duration means
  // no trigger is stored.
  let turnTimeTrigger: string | null = null;
  if (turnTimeHours !== null) {
    turnTimeTrigger = trimOrNull(input.turnTimeTrigger);
    if (!isOneOf(COMMENCEMENT_EVENTS, turnTimeTrigger)) {
      return fail("VALIDATION_ERROR", "Choose the event turn time starts from.");
    }
  }

  const commencementRule = (input.commencementRule ?? "").trim();
  if (!isOneOf(COMMENCEMENT_EVENTS, commencementRule)) {
    return fail("VALIDATION_ERROR", "Choose the event laytime commences from.");
  }

  const commencementTimeRule = trimOrNull(input.commencementTimeRule) ?? "AT_EVENT";
  if (!isOneOf(COMMENCEMENT_TIME_RULES, commencementTimeRule)) {
    return fail("VALIDATION_ERROR", "An invalid commencement time rule was provided.");
  }
  // The 14:00 rule is itself the grace period; combining it with turn time
  // would stack two grace mechanisms the engine does not define together.
  if (commencementTimeRule !== "AT_EVENT" && turnTimeHours !== null) {
    return fail(
      "VALIDATION_ERROR",
      "Use either turn time or the 12:00/14:00 commencement rule, not both."
    );
  }

  const laytimeEndEvent = trimOrNull(input.laytimeEndEvent) ?? "OPS_COMPLETED";
  if (!isOneOf(LAYTIME_END_EVENTS, laytimeEndEvent)) {
    return fail("VALIDATION_ERROR", "Choose the event laytime ends at.");
  }

  const despatchBasis = trimOrNull(input.despatchBasis);
  if (despatchBasis !== null && !isOneOf(DESPATCH_BASES, despatchBasis)) {
    return fail("VALIDATION_ERROR", "An invalid despatch basis was provided.");
  }

  const ruleSetVersionId = (input.ruleSetVersionId ?? "").trim();
  if (ruleSetVersionId === "") {
    return fail("VALIDATION_ERROR", "A rule set version is required.");
  }

  return ok({
    function: input.function,
    portId: trimOrNull(input.portId),
    cargoId: trimOrNull(input.cargoId),
    allowanceBasis,
    allowance,
    allowanceUnit,
    allowanceRate,
    demurrageRate,
    despatchRate,
    despatchBasis,
    turnTimeHours,
    turnTimeTrigger,
    commencementRule,
    commencementTimeRule,
    onceOnDemurrage: input.onceOnDemurrage === true,
    laytimeEndEvent,
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

/**
 * F14 freeze trigger: is this term depended on by a FINALIZED statement?
 * A finalized statement for a voyage whose port call was calculated on this
 * term makes the term immutable — editing it must create a new version rather
 * than mutate the historical basis of that statement.
 */
async function isTermFrozen(
  termId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ one: laytimeStatements.id })
    .from(laytimeStatements)
    .innerJoin(
      voyagePortCalls,
      and(
        eq(voyagePortCalls.voyageId, laytimeStatements.voyageId),
        eq(voyagePortCalls.organizationId, laytimeStatements.organizationId)
      )
    )
    .innerJoin(
      laytimeCalculations,
      and(
        eq(laytimeCalculations.portCallId, voyagePortCalls.id),
        eq(laytimeCalculations.organizationId, voyagePortCalls.organizationId)
      )
    )
    .where(
      and(
        eq(laytimeStatements.organizationId, organizationId),
        eq(laytimeStatements.status, "finalized"),
        eq(laytimeCalculations.termId, termId)
      )
    )
    .limit(1);
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

    // Only LIVE versions are current terms; superseded versions (F14) stay in
    // the database for the finalized statements that depend on them, never
    // shown as an editable current term.
    const base = and(
      eq(contractLaytimeTerms.contractId, contractId),
      eq(contractLaytimeTerms.organizationId, ctx.organizationId),
      isNull(contractLaytimeTerms.supersededByTermId)
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
          allowanceBasis: v.allowanceBasis,
          allowance: v.allowance,
          allowanceUnit: v.allowanceUnit,
          allowanceRate: v.allowanceRate,
          demurrageRate: v.demurrageRate,
          despatchRate: v.despatchRate,
          despatchBasis: v.despatchBasis,
          turnTimeHours: v.turnTimeHours,
          turnTimeTrigger: v.turnTimeTrigger,
          commencementRule: v.commencementRule,
          commencementTimeRule: v.commencementTimeRule,
          onceOnDemurrage: v.onceOnDemurrage,
          laytimeEndEvent: v.laytimeEndEvent,
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
 * Updates a term. If NO finalized statement depends on it, it is edited in
 * place (`versioned: false`). If one does (F14), the term is frozen: a NEW
 * version is created carrying the edited values, this row is marked superseded
 * and left intact (so the finalized statement's historical basis survives),
 * and every live port call that referenced it is repointed to the new version
 * so future work uses the current values. `id` in the result is always the
 * LIVE term id after the operation (the new version's id when versioned).
 *
 * Historical reproducibility (F20) is thereby protected structurally, on top
 * of the resolvedRulesJson snapshot each calculation already carries.
 */
export async function updateContractLaytimeTerm(
  termId: string,
  input: ContractLaytimeTermInput
): Promise<ActionResult<{ id: string; versioned: boolean }>> {
  type Out = { id: string; versioned: boolean };
  return termAction<Out>("masterdata.write", async (ctx) => {
    const validated = validateTermInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({
          contractId: contractLaytimeTerms.contractId,
          versionNumber: contractLaytimeTerms.versionNumber,
          supersededByTermId: contractLaytimeTerms.supersededByTermId,
        })
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
      // A superseded row is historical and never edited directly.
      if (existing[0].supersededByTermId !== null) {
        return fail<Out>(
          "INVALID_STATE",
          "This term has been superseded by a newer version; edit the current version instead."
        );
      }
      const contractId = existing[0].contractId;
      const versionNumber = existing[0].versionNumber;

      // A pool, if given, must belong to the term's own contract.
      if (
        v.poolId !== null &&
        !(await poolBelongsToContract(v.poolId, contractId, ctx.organizationId))
      ) {
        return fail<Out>(
          "NOT_FOUND",
          "The selected pool does not belong to this contract."
        );
      }

      const editedValues = {
        function: v.function,
        portId: v.portId,
        cargoId: v.cargoId,
        allowanceBasis: v.allowanceBasis,
        allowance: v.allowance,
        allowanceUnit: v.allowanceUnit,
        allowanceRate: v.allowanceRate,
        demurrageRate: v.demurrageRate,
        despatchRate: v.despatchRate,
        despatchBasis: v.despatchBasis,
        turnTimeHours: v.turnTimeHours,
        turnTimeTrigger: v.turnTimeTrigger,
        commencementRule: v.commencementRule,
        commencementTimeRule: v.commencementTimeRule,
        onceOnDemurrage: v.onceOnDemurrage,
        laytimeEndEvent: v.laytimeEndEvent,
        ruleSetVersionId: v.ruleSetVersionId,
        poolId: v.poolId,
      };

      const frozen = await isTermFrozen(termId, ctx.organizationId);

      if (!frozen) {
        // Ordinary in-place edit.
        const [updated] = await db
          .update(contractLaytimeTerms)
          .set({ ...editedValues, updatedAt: new Date() })
          .where(
            and(
              eq(contractLaytimeTerms.id, termId),
              eq(contractLaytimeTerms.organizationId, ctx.organizationId)
            )
          )
          .returning({ id: contractLaytimeTerms.id });
        if (!updated) return fail<Out>("NOT_FOUND", "Term not found.");

        await recordAudit(ctx, {
          entityType: "ContractLaytimeTerm",
          entityId: termId,
          action: "update",
          after: v,
        });
        return ok({ id: updated.id, versioned: false });
      }

      // Frozen: create a new version, supersede this row, repoint live port calls.
      const newId = await db.transaction(async (tx) => {
        const [newTerm] = await tx
          .insert(contractLaytimeTerms)
          .values({
            organizationId: ctx.organizationId,
            contractId,
            ...editedValues,
            versionNumber: versionNumber + 1,
          })
          .returning({ id: contractLaytimeTerms.id });

        await tx
          .update(contractLaytimeTerms)
          .set({ supersededByTermId: newTerm.id, updatedAt: new Date() })
          .where(
            and(
              eq(contractLaytimeTerms.id, termId),
              eq(contractLaytimeTerms.organizationId, ctx.organizationId)
            )
          );

        // The contract's stoppage rules belong to the term; carry them to the
        // new version so it calculates exactly like the one it replaces.
        const oldRules = await tx
          .select({
            stoppageReasonId: contractStoppageRules.stoppageReasonId,
            countability: contractStoppageRules.countability,
            excludedOnDemurrage: contractStoppageRules.excludedOnDemurrage,
          })
          .from(contractStoppageRules)
          .where(
            and(
              eq(contractStoppageRules.termId, termId),
              eq(contractStoppageRules.organizationId, ctx.organizationId)
            )
          );
        if (oldRules.length > 0) {
          await tx.insert(contractStoppageRules).values(
            oldRules.map((r) => ({
              organizationId: ctx.organizationId,
              termId: newTerm.id,
              stoppageReasonId: r.stoppageReasonId,
              countability: r.countability,
              excludedOnDemurrage: r.excludedOnDemurrage,
            }))
          );
        }

        await tx
          .update(voyagePortCalls)
          .set({ contractLaytimeTermId: newTerm.id, updatedAt: new Date() })
          .where(
            and(
              eq(voyagePortCalls.contractLaytimeTermId, termId),
              eq(voyagePortCalls.organizationId, ctx.organizationId)
            )
          );

        return newTerm.id;
      });

      await recordAudit(ctx, {
        entityType: "ContractLaytimeTerm",
        entityId: newId,
        action: "version",
        before: { termId, versionNumber },
        after: { ...v, versionNumber: versionNumber + 1, supersedes: termId },
      });

      return ok({ id: newId, versioned: true });
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