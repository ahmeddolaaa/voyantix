import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Multi-tenancy: every business table carries organizationId so the schema
// is resale-ready from day one (see Section 7, Voyantix rebuild spec).
// ---------------------------------------------------------------------------

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Reference / lookup tables
// ---------------------------------------------------------------------------

export const vessels = sqliteTable("vessels", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
});

export const ports = sqliteTable("ports", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
});

export const cargos = sqliteTable("cargos", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
});

export const factories = sqliteTable("factories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
});

export const stoppageReasons = sqliteTable("stoppage_reasons", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
});

// ---------------------------------------------------------------------------
// Contract Terms
// ---------------------------------------------------------------------------

export const contractTerms = sqliteTable("contract_terms", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  termsReference: text("terms_reference").notNull(),
  portId: text("port_id").references(() => ports.id),
  cargoId: text("cargo_id").references(() => cargos.id), // nullable — flagged open question
  allowedLaytimeDays: real("allowed_laytime_days").notNull(),
  demurrageRatePerDay: real("demurrage_rate_per_day").notNull(),
  despatchRatePerDay: real("despatch_rate_per_day").notNull(),
});

// ---------------------------------------------------------------------------
// Voyage
// ---------------------------------------------------------------------------

export const VOYAGE_STATUS = ["On Laytime", "Cargo Complete"] as const;
export type VoyageStatus = (typeof VOYAGE_STATUS)[number];

export const voyages = sqliteTable("voyages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  voyageReference: text("voyage_reference").notNull(),
  vesselId: text("vessel_id")
    .notNull()
    .references(() => vessels.id),
  portId: text("port_id")
    .notNull()
    .references(() => ports.id),
  contractTermsId: text("contract_terms_id").references(() => contractTerms.id),
  status: text("status").notNull().default("On Laytime"),
  arrivalTime: text("arrival_time"),
  norTender: text("nor_tender"),
  norAcceptance: text("nor_acceptance"),
  sailingTime: text("sailing_time"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Cargo Plan
// ---------------------------------------------------------------------------

export const cargoPlans = sqliteTable("cargo_plans", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  planReference: text("plan_reference").notNull(),
  voyageId: text("voyage_id")
    .notNull()
    .references(() => voyages.id),
  cargoId: text("cargo_id")
    .notNull()
    .references(() => cargos.id),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id),
  quantityMt: real("quantity_mt").notNull(),
});

// ---------------------------------------------------------------------------
// Shift Performance
// ---------------------------------------------------------------------------

export const shiftPerformances = sqliteTable("shift_performances", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  shiftReference: text("shift_reference").notNull(),
  voyageId: text("voyage_id")
    .notNull()
    .references(() => voyages.id),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id),
  cargoId: text("cargo_id")
    .notNull()
    .references(() => cargos.id),
  shiftDate: text("shift_date").notNull(), // NOT NULL by design — see lessons learned
  crane: text("crane").notNull(),
  operationType: text("operation_type").notNull(), // Loading | Discharging
  quantityMt: real("quantity_mt").notNull(),
});

// ---------------------------------------------------------------------------
// Stoppage
// ---------------------------------------------------------------------------

export const stoppages = sqliteTable("stoppages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  stoppageReference: text("stoppage_reference").notNull(),
  voyageId: text("voyage_id")
    .notNull()
    .references(() => voyages.id),
  reasonId: text("reason_id")
    .notNull()
    .references(() => stoppageReasons.id),
  startTime: text("start_time").notNull(),
  endTime: text("end_time"), // nullable = still open
});

// ---------------------------------------------------------------------------
// Laytime Statement — Statement Lifecycle Status is THE field that drives
// every canonical-selection rule (Section 3.1 / 3.2 of the spec).
// ---------------------------------------------------------------------------

export const STATEMENT_LIFECYCLE_STATUS = [
  "Draft",
  "Under Review",
  "Finalized",
  "Superseded",
] as const;
export type StatementLifecycleStatus =
  (typeof STATEMENT_LIFECYCLE_STATUS)[number];

export const SETTLEMENT_TYPE = ["Demurrage", "Despatch"] as const;
export type SettlementType = (typeof SETTLEMENT_TYPE)[number];

export const laytimeStatements = sqliteTable("laytime_statements", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  statementReference: text("statement_reference"),
  voyageId: text("voyage_id")
    .notNull()
    .references(() => voyages.id),
  lifecycleStatus: text("lifecycle_status").notNull().default("Draft"),
  timeBalanceDays: real("time_balance_days").notNull(),
  timeUsedDays: real("time_used_days").notNull(),
  laytimeAllowedDays: real("laytime_allowed_days").notNull(),
  settlementAmountUsd: real("settlement_amount_usd").notNull(),
  settlementType: text("settlement_type").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Time Sheet Entry — the engine's granular output. Represents ONLY the
// current calculation result for its Draft Statement (Section 3.3 — no
// versioning/history in V1). Duration is stored in HOURS, consistently,
// end to end (lesson learned from the old system's minute/hour mismatch).
// ---------------------------------------------------------------------------

export const CURRENT_STATE = ["On Laytime", "On Demurrage"] as const;
export type CurrentState = (typeof CURRENT_STATE)[number];

export const COUNTED_OR_EXCLUDED = ["Counted", "Excluded"] as const;
export type CountedOrExcluded = (typeof COUNTED_OR_EXCLUDED)[number];

export const timeSheetEntries = sqliteTable("time_sheet_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  laytimeStatementId: text("laytime_statement_id")
    .notNull()
    .references(() => laytimeStatements.id, { onDelete: "cascade" }),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  durationHours: real("duration_hours").notNull(),
  currentState: text("current_state").notNull(),
  countedOrExcluded: text("counted_or_excluded").notNull(),
  relatedStoppageId: text("related_stoppage_id").references(() => stoppages.id),
});

// Junction table — cascades on Time Sheet Entry delete (schema-level, not
// manually orchestrated — see lessons learned).
export const timeSheetEntryStoppageLinks = sqliteTable(
  "time_sheet_entry_stoppage_links",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    timeSheetEntryId: text("time_sheet_entry_id")
      .notNull()
      .references(() => timeSheetEntries.id, { onDelete: "cascade" }),
    stoppageId: text("stoppage_id")
      .notNull()
      .references(() => stoppages.id, { onDelete: "cascade" }),
  }
);

// ---------------------------------------------------------------------------
// Contract Stoppage Rule — placeholder only, business meaning unresolved
// (Section 9, open decision #3). Not used by the engine yet.
// ---------------------------------------------------------------------------

export const contractStoppageRules = sqliteTable("contract_stoppage_rules", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  contractTermsId: text("contract_terms_id")
    .notNull()
    .references(() => contractTerms.id),
  stoppageReasonId: text("stoppage_reason_id")
    .notNull()
    .references(() => stoppageReasons.id),
  note: text("note"),
});

// ---------------------------------------------------------------------------
// Audit log — minimal, append-only, built in from day one.
// ---------------------------------------------------------------------------

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actorId: text("actor_id"),
  summary: text("summary"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});
