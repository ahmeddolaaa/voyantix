import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  unique,
  index,
  numeric,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./platform";
import { voyages } from "./voyage";
import { voyagePortCalls } from "./voyage";
import { laytimePools } from "./commercial";
import { laytimeCalculations, laytimeBalanceOutcomeEnum } from "./calculated";

/**
 * STATEMENT LAYER — Phase 7
 * ---------------------------------------------------------------------------
 * A LaytimeStatement is a voyage-level document that rolls up the port calls'
 * settled results. Two frozen lifecycle invariants (enforced by the DB, not
 * only the action layer):
 *
 *   - ONE ACTIVE DRAFT per voyage. Building a statement finds 0 → create it,
 *     1 → update it; a partial unique index makes a second draft impossible.
 *   - CANONICAL FINALIZED statement: at most one finalized statement per
 *     voyage, so "the statement" is never ambiguous. 0 → nothing yet, 1 → the
 *     canonical one; a second finalized row is rejected by the DB rather than
 *     silently picked between.
 *
 * A StatementScopeResult is one settled scope inside a statement. Scope is per
 * PORT CALL (defined) or per POOL (reserved; pooled settlement rate selection
 * is withheld, B7 — the build never emits a pool scope yet). It records the
 * balance and the settlement outcome, including when settlement itself refused
 * (despatch basis withheld) or the underlying calculation refused.
 * ---------------------------------------------------------------------------
 */

export const laytimeStatementStatusEnum = pgEnum("laytime_statement_status", [
  "draft",
  "finalized",
]);

export const statementScopeTypeEnum = pgEnum("statement_scope_type", [
  "port_call",
  "pool",
]);

// How a scope settled. 'demurrage'/'despatch'/'none' are settled amounts;
// 'settlement_refused' means the balance is known but settlement refused
// (despatch basis withheld); 'calc_refused' means the calculation itself
// refused, so there is no balance to settle.
export const statementSettlementKindEnum = pgEnum("statement_settlement_kind", [
  "demurrage",
  "despatch",
  "none",
  "settlement_refused",
  "calc_refused",
]);

export const laytimeStatements = pgTable(
  "laytime_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    voyageId: uuid("voyage_id").notNull(),
    status: laytimeStatementStatusEnum("status").notNull().default("draft"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedByUserId: uuid("finalized_by_user_id").references(() => users.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("laytime_statements_org_idx").on(t.organizationId),
    voyageIdx: index("laytime_statements_voyage_idx").on(t.voyageId),
    // Composite unique target so a scope result can FK back tenant-safely.
    orgIdCompositeIdx: unique("laytime_statements_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    // ONE ACTIVE DRAFT per voyage.
    oneDraftIdx: uniqueIndex("laytime_statements_voyage_draft_unique_idx")
      .on(t.voyageId)
      .where(sql`status = 'draft'`),
    // CANONICAL: at most one finalized statement per voyage.
    oneFinalIdx: uniqueIndex("laytime_statements_voyage_final_unique_idx")
      .on(t.voyageId)
      .where(sql`status = 'finalized'`),
    // A finalized statement must carry its finalization stamp; a draft must not.
    finalizeStampCheck: check(
      "laytime_statements_finalize_stamp_check",
      sql`(status = 'draft' and finalized_at is null and finalized_by_user_id is null)
          or (status = 'finalized' and finalized_at is not null and finalized_by_user_id is not null)`
    ),
    voyageOrgFk: foreignKey({
      columns: [t.voyageId, t.organizationId],
      foreignColumns: [voyages.id, voyages.organizationId],
      name: "laytime_statements_voyage_org_fk",
    }).onDelete("cascade"),
  })
);

export const statementScopeResults = pgTable(
  "statement_scope_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id").notNull(),
    scopeType: statementScopeTypeEnum("scope_type").notNull(),
    portCallId: uuid("port_call_id"),
    poolId: uuid("pool_id"),
    // Provenance of the calculation this scope was built from. A single-column
    // reference (always written same-org by construction): a composite FK with
    // ON DELETE SET NULL would try to null the NOT NULL organizationId too. Set
    // null on delete so a recalculation that replaces the calc leaves a clean
    // snapshot rather than a dangling id.
    calculationId: uuid("calculation_id").references(
      () => laytimeCalculations.id,
      { onDelete: "set null" }
    ),

    balanceOutcome: laytimeBalanceOutcomeEnum("balance_outcome"),
    balanceSeconds: numeric("balance_seconds"),
    settlementKind: statementSettlementKindEnum("settlement_kind").notNull(),
    amount: numeric("amount"),
    settlementRefusalCode: text("settlement_refusal_code"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("statement_scope_results_org_idx").on(t.organizationId),
    statementIdx: index("statement_scope_results_statement_idx").on(t.statementId),
    // One result per port call within a statement.
    statementPortCallUniqueIdx: uniqueIndex(
      "statement_scope_results_statement_port_call_unique_idx"
    )
      .on(t.statementId, t.portCallId)
      .where(sql`port_call_id is not null`),
    // Scope shape: a port_call scope names a port call and no pool; a pool
    // scope names a pool and no port call.
    scopeShapeCheck: check(
      "statement_scope_results_scope_shape_check",
      sql`(scope_type = 'port_call' and port_call_id is not null and pool_id is null)
          or (scope_type = 'pool' and pool_id is not null and port_call_id is null)`
    ),
    statementOrgFk: foreignKey({
      columns: [t.statementId, t.organizationId],
      foreignColumns: [laytimeStatements.id, laytimeStatements.organizationId],
      name: "statement_scope_results_statement_org_fk",
    }).onDelete("cascade"),
    portCallOrgFk: foreignKey({
      columns: [t.portCallId, t.organizationId],
      foreignColumns: [voyagePortCalls.id, voyagePortCalls.organizationId],
      name: "statement_scope_results_port_call_org_fk",
    }).onDelete("cascade"),
    poolOrgFk: foreignKey({
      columns: [t.poolId, t.organizationId],
      foreignColumns: [laytimePools.id, laytimePools.organizationId],
      name: "statement_scope_results_pool_org_fk",
    }),
  })
);

// LAYTIME ADJUSTMENT — a manual, audited money line item against a DRAFT
// statement (Phase 7). It is a settlement-side LEDGER entry, not a laytime
// rule: it NEVER changes the engine balance (F16 keeps the engine's balance
// and the settlement layer separate). A signed amount (negative reduces the
// claim, positive adds to it) plus a reason; the statement's net is the
// settled gross plus the sum of its adjustments — pure arithmetic, no invented
// laytime semantic. Currency is implied by the term rates, as in settlement.
//
// Adjustments are only permitted while the statement is a draft; a finalized
// statement is canonical and locked (enforced in the action layer). The fuller
// adjustment workflow (approvals, application rules) remains deferred.
export const laytimeAdjustments = pgTable(
  "laytime_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id").notNull(),
    amount: numeric("amount").notNull(),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("laytime_adjustments_org_idx").on(t.organizationId),
    statementIdx: index("laytime_adjustments_statement_idx").on(t.statementId),
    statementOrgFk: foreignKey({
      columns: [t.statementId, t.organizationId],
      foreignColumns: [laytimeStatements.id, laytimeStatements.organizationId],
      name: "laytime_adjustments_statement_org_fk",
    }).onDelete("cascade"),
  })
);
