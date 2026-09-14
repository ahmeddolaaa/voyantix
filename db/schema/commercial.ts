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
  boolean,
  time,
  date,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./platform";
import { holidayCalendars, entityStatusEnum, ports, cargoes } from "./master-data";

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

// ---------------------------------------------------------------------------
// CONTRACT — fixture header. Not versioned: its commercial values live on
// ContractLaytimeTerm (which IS versioned). The contract itself is just the
// identity of the fixture — reference, counterparty, date. Deleting a
// contract must never rewrite a finalized statement; historical safety comes
// from the term/ruleset versioning and the resolvedRulesJson snapshot, not
// from freezing the contract row.
// ---------------------------------------------------------------------------
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    counterparty: text("counterparty").notNull(),
    contractDate: date("contract_date"),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("contracts_org_idx").on(t.organizationId),
    // Composite unique target so ContractLaytimeTerm can hold a tenant-safe
    // composite FK into this table in the next step.
    orgIdCompositeIdx: unique("contracts_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    referenceUniqueIdx: uniqueIndex("contracts_org_reference_unique_idx").on(
      t.organizationId,
      sql`lower(trim(${t.reference}))`
    ),
  })
);

// ---------------------------------------------------------------------------
// LAYTIME POOL — reversible allowance pool. CONTRACT-OWNED (PO4): a pool
// belongs to one contract and may be referenced by several
// ContractLaytimeTerm rows of that same contract. Not organization-global,
// not term-owned.
//
// settlementPolicy is stored as free text: its vocabulary is withheld (B7)
// and is NOT invented here. This table only records the customer's choice.
// ---------------------------------------------------------------------------
export const laytimePools = pgTable(
  "laytime_pools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull(),
    name: text("name").notNull(),
    totalAllowance: numeric("total_allowance").notNull(),
    allowanceUnit: text("allowance_unit").notNull(),
    settlementPolicy: text("settlement_policy").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("laytime_pools_org_idx").on(t.organizationId),
    contractIdx: index("laytime_pools_contract_idx").on(t.contractId),
    // Composite unique target so ContractLaytimeTerm can hold a tenant-safe
    // composite FK into this table.
    orgIdCompositeIdx: unique("laytime_pools_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    nameUniqueIdx: uniqueIndex("laytime_pools_contract_name_unique_idx").on(
      t.contractId,
      sql`lower(trim(${t.name}))`
    ),
    // CROSS-TENANT INTEGRITY: a pool can only belong to a contract in the
    // SAME organization.
    contractOrgFk: foreignKey({
      columns: [t.contractId, t.organizationId],
      foreignColumns: [contracts.id, contracts.organizationId],
      name: "laytime_pools_contract_org_fk",
    }).onDelete("cascade"),
  })
);

// ---------------------------------------------------------------------------
// CONTRACT LAYTIME TERM — the commercial values (PO1-PO3). Versioned in the
// action layer, not here: editing a term that a finalized statement depends
// on creates a new term version (F14). This schema only holds the current
// values + FKs.
//
// scope = (function, portId?, cargoId?). function is NOT NULL and fixed to
// LOAD/DISCHARGE (PO1); generic applicability comes from leaving portId /
// cargoId null, never from a null function. ruleSetVersionId is NOT NULL:
// every term resolves against exactly one immutable rule-set version (F13).
//
// allowanceUnit / despatchBasis / turnTimeTrigger / commencementRule are free
// text: their vocabularies are withheld (B1/B2) and are NOT encoded here as
// enums or CHECKs. Despatch (rate + basis) is optional; null = despatch not
// configured for this term (PO3). Numeric fields carry no invented
// precision/scale.
// ---------------------------------------------------------------------------
export const contractFunctionEnum = pgEnum("contract_function", [
  "LOAD",
  "DISCHARGE",
]);

export const contractLaytimeTerms = pgTable(
  "contract_laytime_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull(),

    // scope
    function: contractFunctionEnum("function").notNull(),
    portId: uuid("port_id"),
    cargoId: uuid("cargo_id"),

    // commercial values
    allowance: numeric("allowance").notNull(),
    allowanceUnit: text("allowance_unit").notNull(),
    demurrageRate: numeric("demurrage_rate").notNull(),
    despatchRate: numeric("despatch_rate"),
    despatchBasis: text("despatch_basis"),
    turnTimeHours: numeric("turn_time_hours"),
    turnTimeTrigger: text("turn_time_trigger"),
    commencementRule: text("commencement_rule").notNull(),

    // references
    ruleSetVersionId: uuid("rule_set_version_id").notNull(),
    poolId: uuid("pool_id"),

    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("contract_laytime_terms_org_idx").on(t.organizationId),
    contractIdx: index("contract_laytime_terms_contract_idx").on(t.contractId),
    // Composite unique target so VoyagePortCall can hold a tenant-safe
    // composite FK into this table (Phase 4).
    orgIdCompositeIdx: unique("contract_laytime_terms_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    // CROSS-TENANT INTEGRITY on every reference — each target must belong to
    // the SAME organization.
    contractOrgFk: foreignKey({
      columns: [t.contractId, t.organizationId],
      foreignColumns: [contracts.id, contracts.organizationId],
      name: "contract_laytime_terms_contract_org_fk",
    }).onDelete("cascade"),
    ruleSetVersionOrgFk: foreignKey({
      columns: [t.ruleSetVersionId, t.organizationId],
      foreignColumns: [
        laytimeRuleSetVersions.id,
        laytimeRuleSetVersions.organizationId,
      ],
      name: "contract_laytime_terms_rule_set_version_org_fk",
    }),
    poolOrgFk: foreignKey({
      columns: [t.poolId, t.organizationId],
      foreignColumns: [laytimePools.id, laytimePools.organizationId],
      name: "contract_laytime_terms_pool_org_fk",
    }),
    portOrgFk: foreignKey({
      columns: [t.portId, t.organizationId],
      foreignColumns: [ports.id, ports.organizationId],
      name: "contract_laytime_terms_port_org_fk",
    }),
    cargoOrgFk: foreignKey({
      columns: [t.cargoId, t.organizationId],
      foreignColumns: [cargoes.id, cargoes.organizationId],
      name: "contract_laytime_terms_cargo_org_fk",
    }),
  })
);