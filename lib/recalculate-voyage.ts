import { db } from "@/db/client";
import {
  voyages,
  contractTerms,
  stoppages,
  stoppageReasons,
  laytimeStatements,
  timeSheetEntries,
  timeSheetEntryStoppageLinks,
  auditLog,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runLaytimeEngine } from "./engine/laytime-engine";
import { getActiveDraftStatement } from "./canonical-statement";

export type RecalculateResult =
  | { kind: "ok"; statementId: string; created: boolean }
  | { kind: "conflict"; count: number }
  | { kind: "error"; message: string };

/**
 * Recalculates a Voyage's Active Draft Laytime Statement.
 *
 * FROZEN RULES implemented here (Section 3.2 / 3.3):
 *   0 Draft  -> create a new Draft Statement.
 *   1 Draft  -> update that Draft in place, then delete-and-recreate its
 *               Time Sheet Entries (current-calculation-result-only,
 *               no versioning).
 *   >1 Draft -> Data Integrity Exception. Write nothing.
 *
 * The whole "update statement + delete old entries + create new entries"
 * sequence runs inside a single DB transaction: if any step fails, nothing
 * is committed, so a partial/broken result can never be observed by the
 * rest of the app. This is the guarantee the old low-code platform could
 * not provide and it is the entire reason this function exists as a single
 * atomic operation rather than several separate calls.
 */
export async function recalculateVoyage(
  organizationId: string,
  voyageId: string
): Promise<RecalculateResult> {
  const [voyage] = await db
    .select()
    .from(voyages)
    .where(and(eq(voyages.id, voyageId), eq(voyages.organizationId, organizationId)));

  if (!voyage) return { kind: "error", message: "Voyage not found" };
  if (!voyage.contractTermsId)
    return { kind: "error", message: "Voyage has no Contract Terms set" };
  if (!voyage.norAcceptance)
    return { kind: "error", message: "Voyage has no NOR Acceptance time set" };

  const [terms] = await db
    .select()
    .from(contractTerms)
    .where(eq(contractTerms.id, voyage.contractTermsId));
  if (!terms) return { kind: "error", message: "Contract Terms not found" };

  const laytimeEndTime = voyage.sailingTime ?? new Date().toISOString();

  const voyageStoppages = await db
    .select({
      id: stoppages.id,
      reasonId: stoppages.reasonId,
      reasonName: stoppageReasons.name,
      startTime: stoppages.startTime,
      endTime: stoppages.endTime,
    })
    .from(stoppages)
    .innerJoin(stoppageReasons, eq(stoppages.reasonId, stoppageReasons.id))
    .where(eq(stoppages.voyageId, voyageId));

  const engineResult = runLaytimeEngine({
    laytimeStartTime: voyage.norAcceptance,
    laytimeEndTime,
    allowedLaytimeDays: terms.allowedLaytimeDays,
    demurrageRatePerDay: terms.demurrageRatePerDay,
    despatchRatePerDay: terms.despatchRatePerDay,
    stoppages: voyageStoppages,
  });

  const draftLookup = await getActiveDraftStatement(organizationId, voyageId);
  if (draftLookup.kind === "conflict") {
    await db.insert(auditLog).values({
      organizationId,
      entityType: "Voyage",
      entityId: voyageId,
      action: "recalculate_blocked_data_integrity_exception",
      summary: `${draftLookup.count} active Draft Statements found — recalculation aborted, no write performed.`,
    });
    return { kind: "conflict", count: draftLookup.count };
  }

  const now = new Date().toISOString();
  const statementId =
    draftLookup.kind === "none" ? crypto.randomUUID() : draftLookup.statement.id;
  const created = draftLookup.kind === "none";

  try {
    // Single atomic transaction: statement write + entry cleanup + new
    // entries all commit together or not at all. A partial failure can
    // never leave a statement holding a mix of old and new intervals.
    await db.transaction(async (tx) => {
      if (created) {
        await tx.insert(laytimeStatements).values({
          id: statementId,
          organizationId,
          voyageId,
          lifecycleStatus: "Draft",
          timeBalanceDays: engineResult.timeBalanceDays,
          timeUsedDays: engineResult.timeUsedDays,
          laytimeAllowedDays: terms.allowedLaytimeDays,
          settlementAmountUsd: engineResult.settlementAmountUsd,
          settlementType: engineResult.settlementType,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await tx
          .update(laytimeStatements)
          .set({
            timeBalanceDays: engineResult.timeBalanceDays,
            timeUsedDays: engineResult.timeUsedDays,
            laytimeAllowedDays: terms.allowedLaytimeDays,
            settlementAmountUsd: engineResult.settlementAmountUsd,
            settlementType: engineResult.settlementType,
            updatedAt: now,
          })
          .where(eq(laytimeStatements.id, statementId));

        // Delete-and-recreate (Section 3.3). Junction rows clean up via
        // ON DELETE CASCADE at the schema level.
        await tx
          .delete(timeSheetEntries)
          .where(eq(timeSheetEntries.laytimeStatementId, statementId));
      }

      for (const interval of engineResult.intervals) {
        const entryId = crypto.randomUUID();
        await tx.insert(timeSheetEntries).values({
          id: entryId,
          organizationId,
          laytimeStatementId: statementId,
          startTime: interval.startTime,
          endTime: interval.endTime,
          durationHours: interval.durationHours,
          currentState: interval.currentState,
          countedOrExcluded: interval.countedOrExcluded,
          relatedStoppageId: interval.relatedStoppageId,
        });

        if (interval.relatedStoppageId) {
          await tx.insert(timeSheetEntryStoppageLinks).values({
            id: crypto.randomUUID(),
            organizationId,
            timeSheetEntryId: entryId,
            stoppageId: interval.relatedStoppageId,
          });
        }
      }

      await tx.insert(auditLog).values({
        organizationId,
        entityType: "LaytimeStatement",
        entityId: statementId,
        action: created ? "statement_created" : "statement_recalculated",
        summary: `${engineResult.intervals.length} time sheet entries persisted. Time Balance ${engineResult.timeBalanceDays}d, ${engineResult.settlementType} $${engineResult.settlementAmountUsd}.`,
      });
    });
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "Unknown error during recalculation",
    };
  }

  return { kind: "ok", statementId, created };
}
