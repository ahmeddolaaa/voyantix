import { db } from "@/db/client";
import { laytimeStatements } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * FROZEN RULE — Canonical Finalized Statement selection (Section 3.1).
 *
 * 0 Finalized  -> no canonical statement.
 * 1 Finalized  -> that statement is canonical.
 * >1 Finalized -> Data Integrity Exception. Never guess.
 *
 * Never replace this with `.limit(1)` / "most recent" / any implicit
 * ordering shortcut — the whole point of this function existing is to make
 * that mistake structurally impossible to make by accident elsewhere in
 * the codebase.
 */
export type CanonicalStatementResult =
  | { kind: "none" }
  | { kind: "found"; statement: typeof laytimeStatements.$inferSelect }
  | { kind: "conflict"; count: number };

export async function getCanonicalFinalizedStatement(
  organizationId: string,
  voyageId: string
): Promise<CanonicalStatementResult> {
  const finalized = await db
    .select()
    .from(laytimeStatements)
    .where(
      and(
        eq(laytimeStatements.organizationId, organizationId),
        eq(laytimeStatements.voyageId, voyageId),
        eq(laytimeStatements.lifecycleStatus, "Finalized")
      )
    );

  if (finalized.length === 0) return { kind: "none" };
  if (finalized.length === 1)
    return { kind: "found", statement: finalized[0] };
  return { kind: "conflict", count: finalized.length };
}

/**
 * Draft lookup used by the recalculation path (Section 3.2). Returns the
 * same three-way shape so callers apply the identical no-arbitrary-
 * selection discipline to Drafts as to Finalized statements.
 */
export async function getActiveDraftStatement(
  organizationId: string,
  voyageId: string
): Promise<CanonicalStatementResult> {
  const drafts = await db
    .select()
    .from(laytimeStatements)
    .where(
      and(
        eq(laytimeStatements.organizationId, organizationId),
        eq(laytimeStatements.voyageId, voyageId),
        eq(laytimeStatements.lifecycleStatus, "Draft")
      )
    );

  if (drafts.length === 0) return { kind: "none" };
  if (drafts.length === 1) return { kind: "found", statement: drafts[0] };
  return { kind: "conflict", count: drafts.length };
}
