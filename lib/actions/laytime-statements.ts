"use server";

import { db } from "@/db/client";
import {
  voyages,
  voyagePortCalls,
  contractLaytimeTerms,
  laytimeCalculations,
  laytimeStatements,
  statementScopeResults,
  laytimeAdjustments,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";
import { loadSettlementDayPrecision } from "./_settlement-precision";
import { settleBalance } from "@/lib/laytime/settlement";
import { CalculationRefused } from "@/lib/laytime/refuse";

/**
 * LAYTIME STATEMENT — voyage-level lifecycle (Phase 7).
 *
 * buildStatementDraft rolls every calculated port call of a voyage into the
 * voyage's single DRAFT statement, settling each into a StatementScopeResult.
 * One active draft (0 → create, 1 → rewrite its scopes); the DB's partial
 * unique index makes a second draft impossible. finalizeStatement promotes the
 * draft to the voyage's CANONICAL finalized statement — at most one, guarded by
 * the DB. getStatement returns the canonical statement if finalized, else the
 * draft.
 *
 * Per-pool scope is reserved but never emitted: pooled settlement rate
 * selection is withheld (B7). Only per-port-call scopes are produced.
 */

type ScopeRow = {
  organizationId: string;
  statementId: string;
  scopeType: "port_call";
  portCallId: string;
  poolId: null;
  calculationId: string;
  balanceOutcome: "SAVED" | "EXCEEDED" | "EXACT" | null;
  balanceSeconds: string | null;
  settlementKind:
    | "demurrage"
    | "despatch"
    | "none"
    | "settlement_refused"
    | "calc_refused";
  amount: string | null;
  settlementRefusalCode: string | null;
};

export type BuildStatementResult = {
  statementId: string;
  status: "draft";
  scopeCount: number;
  demurrageTotal: number;
  despatchTotal: number;
  /** Port calls whose calculation or settlement could not resolve to a figure. */
  unresolvedCount: number;
};

export async function buildStatementDraft(
  voyageId: string
): Promise<ActionResult<BuildStatementResult>> {
  try {
    return await authorized<ActionResult<BuildStatementResult>>(
      "statement.recalculate",
      async (ctx) => {
        const [voyage] = await db
          .select({ id: voyages.id })
          .from(voyages)
          .where(
            and(eq(voyages.id, voyageId), eq(voyages.organizationId, ctx.organizationId))
          );
        if (!voyage) return fail<BuildStatementResult>("NOT_FOUND", "Voyage not found.");

        const dayPrecision = await loadSettlementDayPrecision(ctx.organizationId);

        // Every calculated/refused port call of the voyage, with its rates.
        const rows = await db
          .select({
            portCallId: laytimeCalculations.portCallId,
            calculationId: laytimeCalculations.id,
            status: laytimeCalculations.status,
            outcome: laytimeCalculations.outcome,
            balanceSeconds: laytimeCalculations.balanceSeconds,
            refusalCode: laytimeCalculations.refusalCode,
            demurrageRate: contractLaytimeTerms.demurrageRate,
            despatchRate: contractLaytimeTerms.despatchRate,
            despatchBasis: contractLaytimeTerms.despatchBasis,
          })
          .from(laytimeCalculations)
          .innerJoin(
            voyagePortCalls,
            and(
              eq(voyagePortCalls.id, laytimeCalculations.portCallId),
              eq(voyagePortCalls.organizationId, laytimeCalculations.organizationId)
            )
          )
          .innerJoin(
            contractLaytimeTerms,
            and(
              eq(contractLaytimeTerms.id, laytimeCalculations.termId),
              eq(contractLaytimeTerms.organizationId, laytimeCalculations.organizationId)
            )
          )
          .where(
            and(
              eq(voyagePortCalls.voyageId, voyageId),
              eq(laytimeCalculations.organizationId, ctx.organizationId)
            )
          );

        const result = await db.transaction(async (tx) => {
          // One active draft: reuse it, else create it.
          const [existingDraft] = await tx
            .select({ id: laytimeStatements.id })
            .from(laytimeStatements)
            .where(
              and(
                eq(laytimeStatements.voyageId, voyageId),
                eq(laytimeStatements.organizationId, ctx.organizationId),
                eq(laytimeStatements.status, "draft")
              )
            );

          let statementId: string;
          if (existingDraft) {
            statementId = existingDraft.id;
            await tx
              .update(laytimeStatements)
              .set({ updatedAt: new Date() })
              .where(eq(laytimeStatements.id, statementId));
            // Rewrite its scopes.
            await tx
              .delete(statementScopeResults)
              .where(
                and(
                  eq(statementScopeResults.statementId, statementId),
                  eq(statementScopeResults.organizationId, ctx.organizationId)
                )
              );
          } else {
            const [created] = await tx
              .insert(laytimeStatements)
              .values({
                organizationId: ctx.organizationId,
                voyageId,
                status: "draft",
                createdByUserId: ctx.userId,
              })
              .returning({ id: laytimeStatements.id });
            statementId = created.id;
          }

          let demurrageTotal = 0;
          let despatchTotal = 0;
          let unresolvedCount = 0;
          const scopeRows: ScopeRow[] = [];

          for (const r of rows) {
            const commonScope = {
              organizationId: ctx.organizationId,
              statementId,
              scopeType: "port_call" as const,
              portCallId: r.portCallId,
              poolId: null,
              calculationId: r.calculationId,
            };

            if (r.status === "refused") {
              unresolvedCount += 1;
              scopeRows.push({
                ...commonScope,
                balanceOutcome: null,
                balanceSeconds: null,
                settlementKind: "calc_refused",
                amount: null,
                settlementRefusalCode: r.refusalCode,
              });
              continue;
            }

            try {
              const s = settleBalance({
                outcome: r.outcome!,
                balanceSeconds: Number(r.balanceSeconds),
                demurrageRate: Number(r.demurrageRate),
                despatchRate: r.despatchRate === null ? null : Number(r.despatchRate),
                despatchBasis: r.despatchBasis,
                dayPrecision,
              });
              if (s.kind === "demurrage") demurrageTotal += s.amount;
              if (s.kind === "despatch") despatchTotal += s.amount;
              scopeRows.push({
                ...commonScope,
                balanceOutcome: r.outcome,
                balanceSeconds: r.balanceSeconds,
                settlementKind: s.kind,
                amount:
                  s.kind === "demurrage" || s.kind === "despatch"
                    ? String(s.amount)
                    : null,
                settlementRefusalCode: null,
              });
            } catch (e) {
              if (e instanceof CalculationRefused) {
                unresolvedCount += 1;
                scopeRows.push({
                  ...commonScope,
                  balanceOutcome: r.outcome,
                  balanceSeconds: r.balanceSeconds,
                  settlementKind: "settlement_refused",
                  amount: null,
                  settlementRefusalCode: e.code,
                });
              } else {
                throw e;
              }
            }
          }

          if (scopeRows.length) {
            await tx.insert(statementScopeResults).values(scopeRows);
          }

          return {
            statementId,
            scopeCount: scopeRows.length,
            demurrageTotal,
            despatchTotal,
            unresolvedCount,
          };
        });

        await recordAudit(ctx, {
          entityType: "LaytimeStatement",
          entityId: result.statementId,
          action: "build_draft",
          after: { scopeCount: result.scopeCount },
        });

        return ok<BuildStatementResult>({ ...result, status: "draft" });
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<BuildStatementResult>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}

export type FinalizeStatementResult = { statementId: string; status: "finalized" };

export async function finalizeStatement(
  voyageId: string
): Promise<ActionResult<FinalizeStatementResult>> {
  try {
    return await authorized<ActionResult<FinalizeStatementResult>>(
      "statement.finalize",
      async (ctx) => {
        const [voyage] = await db
          .select({ id: voyages.id })
          .from(voyages)
          .where(
            and(eq(voyages.id, voyageId), eq(voyages.organizationId, ctx.organizationId))
          );
        if (!voyage) return fail<FinalizeStatementResult>("NOT_FOUND", "Voyage not found.");

        // Canonical: a voyage may hold only one finalized statement.
        const [alreadyFinal] = await db
          .select({ id: laytimeStatements.id })
          .from(laytimeStatements)
          .where(
            and(
              eq(laytimeStatements.voyageId, voyageId),
              eq(laytimeStatements.organizationId, ctx.organizationId),
              eq(laytimeStatements.status, "finalized")
            )
          );
        if (alreadyFinal) {
          return fail<FinalizeStatementResult>(
            "CONFLICT",
            "A finalized statement already exists for this voyage."
          );
        }

        const [draft] = await db
          .select({ id: laytimeStatements.id })
          .from(laytimeStatements)
          .where(
            and(
              eq(laytimeStatements.voyageId, voyageId),
              eq(laytimeStatements.organizationId, ctx.organizationId),
              eq(laytimeStatements.status, "draft")
            )
          );
        if (!draft) {
          return fail<FinalizeStatementResult>(
            "INVALID_STATE",
            "There is no draft statement to finalize."
          );
        }

        await db
          .update(laytimeStatements)
          .set({
            status: "finalized",
            finalizedAt: new Date(),
            finalizedByUserId: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(laytimeStatements.id, draft.id),
              eq(laytimeStatements.organizationId, ctx.organizationId)
            )
          );

        await recordAudit(ctx, {
          entityType: "LaytimeStatement",
          entityId: draft.id,
          action: "finalize",
        });

        return ok<FinalizeStatementResult>({ statementId: draft.id, status: "finalized" });
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<FinalizeStatementResult>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}

export type StatementScope = {
  portCallId: string | null;
  scopeType: "port_call" | "pool";
  balanceOutcome: "SAVED" | "EXCEEDED" | "EXACT" | null;
  balanceSeconds: number | null;
  settlementKind:
    | "demurrage"
    | "despatch"
    | "none"
    | "settlement_refused"
    | "calc_refused";
  amount: number | null;
  settlementRefusalCode: string | null;
};

export type StatementAdjustment = {
  id: string;
  amount: number;
  reason: string;
  createdAt: Date;
};

export type StatementView = {
  id: string;
  status: "draft" | "finalized";
  finalizedAt: Date | null;
  demurrageTotal: number;
  despatchTotal: number;
  unresolvedCount: number;
  scopes: StatementScope[];
  adjustments: StatementAdjustment[];
  adjustmentsTotal: number;
  /** Settled net plus adjustments: demurrageTotal − despatchTotal + adjustments.
   *  A plain netting of the settled figures; no laytime rule is applied here. */
  netClaim: number;
};

export async function getStatement(
  voyageId: string
): Promise<ActionResult<StatementView | null>> {
  try {
    return await authorized<ActionResult<StatementView | null>>(
      "statement.read",
      async (ctx) => {
        // Canonical if finalized, else the draft.
        const finalized = await db
          .select()
          .from(laytimeStatements)
          .where(
            and(
              eq(laytimeStatements.voyageId, voyageId),
              eq(laytimeStatements.organizationId, ctx.organizationId),
              eq(laytimeStatements.status, "finalized")
            )
          );
        if (finalized.length > 1) {
          return fail<StatementView | null>(
            "CONFLICT",
            "Integrity error: more than one finalized statement for this voyage."
          );
        }

        let statement = finalized[0];
        if (!statement) {
          const [draft] = await db
            .select()
            .from(laytimeStatements)
            .where(
              and(
                eq(laytimeStatements.voyageId, voyageId),
                eq(laytimeStatements.organizationId, ctx.organizationId),
                eq(laytimeStatements.status, "draft")
              )
            );
          statement = draft;
        }
        if (!statement) return ok<StatementView | null>(null);

        const scopeRows = await db
          .select({
            portCallId: statementScopeResults.portCallId,
            scopeType: statementScopeResults.scopeType,
            balanceOutcome: statementScopeResults.balanceOutcome,
            balanceSeconds: statementScopeResults.balanceSeconds,
            settlementKind: statementScopeResults.settlementKind,
            amount: statementScopeResults.amount,
            settlementRefusalCode: statementScopeResults.settlementRefusalCode,
          })
          .from(statementScopeResults)
          .where(
            and(
              eq(statementScopeResults.statementId, statement.id),
              eq(statementScopeResults.organizationId, ctx.organizationId)
            )
          );

        let demurrageTotal = 0;
        let despatchTotal = 0;
        let unresolvedCount = 0;
        const scopes: StatementScope[] = scopeRows.map((r) => {
          const amount = r.amount === null ? null : Number(r.amount);
          if (r.settlementKind === "demurrage" && amount !== null) demurrageTotal += amount;
          if (r.settlementKind === "despatch" && amount !== null) despatchTotal += amount;
          if (r.settlementKind === "settlement_refused" || r.settlementKind === "calc_refused") {
            unresolvedCount += 1;
          }
          return {
            portCallId: r.portCallId,
            scopeType: r.scopeType,
            balanceOutcome: r.balanceOutcome,
            balanceSeconds: r.balanceSeconds === null ? null : Number(r.balanceSeconds),
            settlementKind: r.settlementKind,
            amount,
            settlementRefusalCode: r.settlementRefusalCode,
          };
        });

        const adjustmentRows = await db
          .select({
            id: laytimeAdjustments.id,
            amount: laytimeAdjustments.amount,
            reason: laytimeAdjustments.reason,
            createdAt: laytimeAdjustments.createdAt,
          })
          .from(laytimeAdjustments)
          .where(
            and(
              eq(laytimeAdjustments.statementId, statement.id),
              eq(laytimeAdjustments.organizationId, ctx.organizationId)
            )
          );
        const adjustments: StatementAdjustment[] = adjustmentRows.map((a) => ({
          id: a.id,
          amount: Number(a.amount),
          reason: a.reason,
          createdAt: a.createdAt,
        }));
        const adjustmentsTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);

        return ok<StatementView | null>({
          id: statement.id,
          status: statement.status,
          finalizedAt: statement.finalizedAt,
          demurrageTotal,
          despatchTotal,
          unresolvedCount,
          scopes,
          adjustments,
          adjustmentsTotal,
          netClaim: demurrageTotal - despatchTotal + adjustmentsTotal,
        });
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<StatementView | null>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}

// --- adjustments: manual money ledger on a draft statement -----------------

/** Confirms the statement is in the caller's org and returns its status. */
async function statementStatus(
  statementId: string,
  organizationId: string
): Promise<"draft" | "finalized" | null> {
  const [row] = await db
    .select({ status: laytimeStatements.status })
    .from(laytimeStatements)
    .where(
      and(
        eq(laytimeStatements.id, statementId),
        eq(laytimeStatements.organizationId, organizationId)
      )
    );
  return row ? row.status : null;
}

export async function addAdjustment(
  statementId: string,
  input: { amount: number; reason: string }
): Promise<ActionResult<{ id: string }>> {
  try {
    return await authorized<ActionResult<{ id: string }>>(
      "statement.recalculate",
      async (ctx) => {
        if (!Number.isFinite(input.amount)) {
          return fail<{ id: string }>("VALIDATION_ERROR", "The amount must be a number.");
        }
        const reason = (input.reason ?? "").trim();
        if (reason === "") {
          return fail<{ id: string }>("VALIDATION_ERROR", "A reason is required.");
        }
        const status = await statementStatus(statementId, ctx.organizationId);
        if (status === null) {
          return fail<{ id: string }>("NOT_FOUND", "Statement not found.");
        }
        if (status === "finalized") {
          return fail<{ id: string }>(
            "INVALID_STATE",
            "A finalized statement is locked; adjustments cannot be added."
          );
        }

        const [row] = await db
          .insert(laytimeAdjustments)
          .values({
            organizationId: ctx.organizationId,
            statementId,
            amount: String(input.amount),
            reason,
            createdByUserId: ctx.userId,
          })
          .returning({ id: laytimeAdjustments.id });

        await recordAudit(ctx, {
          entityType: "LaytimeAdjustment",
          entityId: row.id,
          action: "add",
          after: { statementId, amount: input.amount, reason },
        });
        return ok({ id: row.id });
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<{ id: string }>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}

export async function deleteAdjustment(
  id: string
): Promise<ActionResult<{ id: string }>> {
  try {
    return await authorized<ActionResult<{ id: string }>>(
      "statement.recalculate",
      async (ctx) => {
        // Only removable while the parent statement is a draft.
        const [adj] = await db
          .select({ statementId: laytimeAdjustments.statementId })
          .from(laytimeAdjustments)
          .where(
            and(
              eq(laytimeAdjustments.id, id),
              eq(laytimeAdjustments.organizationId, ctx.organizationId)
            )
          );
        if (!adj) return fail<{ id: string }>("NOT_FOUND", "Adjustment not found.");

        const status = await statementStatus(adj.statementId, ctx.organizationId);
        if (status === "finalized") {
          return fail<{ id: string }>(
            "INVALID_STATE",
            "A finalized statement is locked; adjustments cannot be removed."
          );
        }

        await db
          .delete(laytimeAdjustments)
          .where(
            and(
              eq(laytimeAdjustments.id, id),
              eq(laytimeAdjustments.organizationId, ctx.organizationId)
            )
          );
        await recordAudit(ctx, {
          entityType: "LaytimeAdjustment",
          entityId: id,
          action: "delete",
        });
        return ok({ id });
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<{ id: string }>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}
