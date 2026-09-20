import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  unique,
  index,
  integer,
  numeric,
  jsonb,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./platform";
import { contractLaytimeTerms, laytimeRuleSetVersions } from "./commercial";
import { voyagePortCalls } from "./voyage";
import { stoppages } from "./operational";

/**
 * CALCULATED LAYER — Phase 7
 * ---------------------------------------------------------------------------
 * The persisted output of the engine. LaytimeInterval is the SINGLE SOURCE OF
 * CALCULATION TRUTH (F19): there is deliberately no TimeSheetEntry table — the
 * time sheet is a query over intervals.
 *
 * A LaytimeCalculation is the latest engine run for a port call: recalculation
 * DELETES the prior intervals and rewrites them inside one transaction, so a
 * port call carries exactly one current calculation (uniqueness enforced
 * below). Historical reproducibility comes from three layers (F20): the
 * immutable RuleSetVersion, the versioned ContractLaytimeTerm, and the
 * resolvedRulesJson snapshot + engineVersion stamped here.
 *
 * A REFUSAL is a persisted outcome, not a dropped one: the engine's discipline
 * is to refuse rather than guess, so status = 'refused' records the refusal
 * code and reason with no intervals. status = 'calculated' carries the window,
 * balance and the interval time-sheet.
 * ---------------------------------------------------------------------------
 */

export const laytimeCalculationStatusEnum = pgEnum("laytime_calculation_status", [
  "calculated",
  "refused",
]);

export const laytimeBalanceOutcomeEnum = pgEnum("laytime_balance_outcome", [
  "SAVED",
  "EXCEEDED",
  "EXACT",
]);

export const laytimeIntervalTreatmentEnum = pgEnum("laytime_interval_treatment", [
  "COUNTED",
  "EXCLUDED",
]);

export const laytimeCalculations = pgTable(
  "laytime_calculations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    portCallId: uuid("port_call_id").notNull(),

    // provenance — which commercial inputs produced this run
    termId: uuid("term_id").notNull(),
    ruleSetVersionId: uuid("rule_set_version_id").notNull(),

    status: laytimeCalculationStatusEnum("status").notNull(),

    // refusal outcome
    refusalCode: text("refusal_code"),
    refusalReason: text("refusal_reason"),

    // calculated outcome
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    commencementAt: timestamp("commencement_at", { withTimezone: true }),
    turnTimeStart: timestamp("turn_time_start", { withTimezone: true }),
    turnTimeEnd: timestamp("turn_time_end", { withTimezone: true }),
    allowedSeconds: numeric("allowed_seconds"),
    usedSeconds: numeric("used_seconds"),
    balanceSeconds: numeric("balance_seconds"),
    outcome: laytimeBalanceOutcomeEnum("outcome"),

    // reproducibility (F20)
    resolvedRulesJson: jsonb("resolved_rules_json").notNull(),
    engineVersion: text("engine_version").notNull(),

    calculatedByUserId: uuid("calculated_by_user_id")
      .notNull()
      .references(() => users.id),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("laytime_calculations_org_idx").on(t.organizationId),
    portCallIdx: index("laytime_calculations_port_call_idx").on(t.portCallId),
    // One current calculation per port call — recalculation replaces it.
    portCallUniqueIdx: uniqueIndex("laytime_calculations_port_call_unique_idx").on(
      t.portCallId
    ),
    // Composite unique target so LaytimeInterval can hold a tenant-safe
    // composite FK back into this table.
    orgIdCompositeIdx: unique("laytime_calculations_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    // Outcome shape: a refusal carries a code; a calculation carries a window,
    // an allowance and a balance outcome. This keeps the two states honest.
    outcomeShapeCheck: check(
      "laytime_calculations_outcome_shape_check",
      sql`(status = 'refused' and refusal_code is not null
             and window_start is null and window_end is null
             and allowed_seconds is null and used_seconds is null
             and balance_seconds is null and outcome is null)
          or
          (status = 'calculated' and refusal_code is null
             and window_start is not null and window_end is not null
             and allowed_seconds is not null and used_seconds is not null
             and balance_seconds is not null and outcome is not null)`
    ),
    portCallOrgFk: foreignKey({
      columns: [t.portCallId, t.organizationId],
      foreignColumns: [voyagePortCalls.id, voyagePortCalls.organizationId],
      name: "laytime_calculations_port_call_org_fk",
    }).onDelete("cascade"),
    termOrgFk: foreignKey({
      columns: [t.termId, t.organizationId],
      foreignColumns: [contractLaytimeTerms.id, contractLaytimeTerms.organizationId],
      name: "laytime_calculations_term_org_fk",
    }),
    ruleSetVersionOrgFk: foreignKey({
      columns: [t.ruleSetVersionId, t.organizationId],
      foreignColumns: [
        laytimeRuleSetVersions.id,
        laytimeRuleSetVersions.organizationId,
      ],
      name: "laytime_calculations_rule_set_version_org_fk",
    }),
  })
);

// LAYTIME INTERVAL — one classified slice of the time sheet (F19: the single
// source of calculation truth). Contiguous, ordered by `sequence`, together
// spanning the whole countable window.
export const laytimeIntervals = pgTable(
  "laytime_intervals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    calculationId: uuid("calculation_id").notNull(),
    // Denormalized so the time sheet for a port call is a direct query.
    portCallId: uuid("port_call_id").notNull(),
    sequence: integer("sequence").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    treatment: laytimeIntervalTreatmentEnum("treatment").notNull(),
    reasons: text("reasons").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("laytime_intervals_org_idx").on(t.organizationId),
    calculationIdx: index("laytime_intervals_calculation_idx").on(t.calculationId),
    portCallIdx: index("laytime_intervals_port_call_idx").on(t.portCallId),
    calcSequenceUniqueIdx: uniqueIndex(
      "laytime_intervals_calc_sequence_unique_idx"
    ).on(t.calculationId, t.sequence),
    // Composite unique target so the stoppage link can FK back tenant-safely.
    orgIdCompositeIdx: unique("laytime_intervals_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    endAfterStartCheck: check(
      "laytime_intervals_end_after_start_check",
      sql`end_time > start_time`
    ),
    calculationOrgFk: foreignKey({
      columns: [t.calculationId, t.organizationId],
      foreignColumns: [laytimeCalculations.id, laytimeCalculations.organizationId],
      name: "laytime_intervals_calculation_org_fk",
    }).onDelete("cascade"),
    portCallOrgFk: foreignKey({
      columns: [t.portCallId, t.organizationId],
      foreignColumns: [voyagePortCalls.id, voyagePortCalls.organizationId],
      name: "laytime_intervals_port_call_org_fk",
    }).onDelete("cascade"),
  })
);

// LAYTIME INTERVAL ↔ STOPPAGE LINK — traceability from an excluded interval
// back to the stoppage that caused it. The engine cuts intervals at stoppage
// boundaries, so a stoppage-excluded interval sits within exactly one
// stoppage; the persistence layer correlates them by containment.
export const laytimeIntervalStoppageLinks = pgTable(
  "laytime_interval_stoppage_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    intervalId: uuid("interval_id").notNull(),
    stoppageId: uuid("stoppage_id").notNull(),
  },
  (t) => ({
    orgIdx: index("laytime_interval_stoppage_links_org_idx").on(t.organizationId),
    intervalIdx: index("laytime_interval_stoppage_links_interval_idx").on(
      t.intervalId
    ),
    intervalStoppageUniqueIdx: uniqueIndex(
      "laytime_interval_stoppage_links_interval_stoppage_unique_idx"
    ).on(t.intervalId, t.stoppageId),
    intervalOrgFk: foreignKey({
      columns: [t.intervalId, t.organizationId],
      foreignColumns: [laytimeIntervals.id, laytimeIntervals.organizationId],
      name: "laytime_interval_stoppage_links_interval_org_fk",
    }).onDelete("cascade"),
    stoppageOrgFk: foreignKey({
      columns: [t.stoppageId, t.organizationId],
      foreignColumns: [stoppages.id, stoppages.organizationId],
      name: "laytime_interval_stoppage_links_stoppage_org_fk",
    }).onDelete("cascade"),
  })
);
