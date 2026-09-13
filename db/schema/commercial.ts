import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  unique,
  index,
  integer,
  boolean,
  time,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./platform";
import { holidayCalendars } from "./master-data";

/**
 * COMMERCIAL LAYER — Phase 3
 * ---------------------------------------------------------------------------
 * The commercial agreement: what laytime is allowed, at what rates, under
 * which reusable rule semantics. Independent of any actual voyage (Phase 4).
 *
 * This file defines ONLY the rule-set container and its versions. Contract,
 * ContractLaytimeTerm, LaytimePool and ContractStoppageRule follow in later
 * steps of Phase 3.
 *
 * IMMUTABILITY (frozen decision F13): a LaytimeRuleSetVersion is immutable
 * once a ContractLaytimeTerm references it. That cannot be enforced by a
 * CHECK constraint — it depends on whether another row points here — so it
 * is enforced in the action layer: editing a referenced version creates a
 * NEW version instead of mutating the old one. The schema here only provides
 * the structure (ruleSetId + versionNumber) that makes that possible.
 *
 * The columns on a version are reusable SEMANTICS ONLY — which weekdays are
 * excluded, holidays yes/no, EIU yes/no, weather yes/no, the working-day
 * window. They store the customer's CHOICE as data. They do NOT encode any
 * engine rule meaning: the actual weekday convention (B5), weather
 * determination (B3) and holiday precedence (B4) are withheld and belong to
 * the engine in Phase 6. excludedWeekdays is a set of day numbers as DATA,
 * never a hardcoded universal weekend.
 * ---------------------------------------------------------------------------
 */

// LAYTIME RULE SET — reusable named container. Header only; all values live
// on its versions. Two contracts can share "Friday + holidays + EIU" while
// carrying entirely different allowances and rates on their own terms.
export const laytimeRuleSets = pgTable(
  "laytime_rule_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("laytime_rule_sets_org_idx").on(t.organizationId),
    // Composite unique target so a version can hold a tenant-safe composite
    // FK back into its rule set (see laytimeRuleSetVersions.ruleSetOrgFk).
    // Inline table CONSTRAINT so it exists at CREATE TABLE time.
    orgIdCompositeIdx: unique("laytime_rule_sets_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    nameUniqueIdx: uniqueIndex("laytime_rule_sets_org_name_unique_idx").on(
      t.organizationId,
      sql`lower(trim(${t.name}))`
    ),
  })
);

// LAYTIME RULE SET VERSION — an immutable-once-referenced snapshot of the
// reusable semantics. versionNumber is sequential within a rule set; a new
// edit adds a new version rather than mutating an existing one.
export const laytimeRuleSetVersions = pgTable(
  "laytime_rule_set_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ruleSetId: uuid("rule_set_id").notNull(),
    versionNumber: integer("version_number").notNull(),

    // Reusable semantics — DATA, not engine logic.
    excludedWeekdays: integer("excluded_weekdays").array().notNull().default([]),
    excludeHolidays: boolean("exclude_holidays").notNull().default(false),
    eiuApplies: boolean("eiu_applies").notNull().default(false),
    weatherApplies: boolean("weather_applies").notNull().default(false),
    workingDayStart: time("working_day_start"),
    workingDayEnd: time("working_day_end"),
    holidayCalendarId: uuid("holiday_calendar_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("laytime_rule_set_versions_org_idx").on(t.organizationId),
    ruleSetIdx: index("laytime_rule_set_versions_rule_set_idx").on(t.ruleSetId),
    // versionNumber is unique within a rule set.
    versionUniqueIdx: uniqueIndex(
      "laytime_rule_set_versions_ruleset_version_unique_idx"
    ).on(t.ruleSetId, t.versionNumber),
    // Composite unique target so ContractLaytimeTerm can hold a tenant-safe
    // composite FK into this table in a later step.
    orgIdCompositeIdx: unique("laytime_rule_set_versions_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    // CROSS-TENANT INTEGRITY: a version can only belong to a rule set in the
    // SAME organization.
    ruleSetOrgFk: foreignKey({
      columns: [t.ruleSetId, t.organizationId],
      foreignColumns: [laytimeRuleSets.id, laytimeRuleSets.organizationId],
      name: "laytime_rule_set_versions_rule_set_org_fk",
    }).onDelete("cascade"),
    // CROSS-TENANT INTEGRITY: an optional holiday calendar reference must
    // belong to the SAME organization.
    holidayCalendarOrgFk: foreignKey({
      columns: [t.holidayCalendarId, t.organizationId],
      foreignColumns: [holidayCalendars.id, holidayCalendars.organizationId],
      name: "laytime_rule_set_versions_holiday_calendar_org_fk",
    }),
  })
);