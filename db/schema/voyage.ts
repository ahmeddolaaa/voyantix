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
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./platform";
import { vessels, ports, facilities, cargoes } from "./master-data";
import { contracts, contractLaytimeTerms, contractFunctionEnum } from "./commercial";

/**
 * VOYAGE — Phase 4
 * ---------------------------------------------------------------------------
 * The operational spine. voyageReference is generated from
 * CompanyConfiguration.voyageReferencePattern + ReferenceSequence
 * (transactional, per org+scope), with manual override allowed. vesselName
 * is the operational truth even when vesselId links to a master Vessel row
 * (see master-data.ts comment on vessels — editing a master Vessel row never
 * rewrites historical Voyage.vesselName values). contractId is optional; a
 * voyage need not have a commercial contract attached yet.
 *
 * status (PO8) is purely administrative: ACTIVE | COMPLETED | CANCELLED.
 * Not derived from PortCall state; no enforced transitions in Phase 4.
 * ---------------------------------------------------------------------------
 */
export const voyageStatusEnum = pgEnum("voyage_status", [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

export const voyages = pgTable(
  "voyages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    voyageReference: text("voyage_reference").notNull(),
    vesselName: text("vessel_name").notNull(),
    vesselId: uuid("vessel_id"),
    contractId: uuid("contract_id"),
    status: voyageStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("voyages_org_idx").on(t.organizationId),
    // Composite unique target so VoyagePortCall can hold a tenant-safe
    // composite FK into this table in the next schema step.
    orgIdCompositeIdx: unique("voyages_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    referenceUniqueIdx: uniqueIndex("voyages_org_reference_unique_idx").on(
      t.organizationId,
      sql`lower(trim(${t.voyageReference}))`
    ),
    // CROSS-TENANT INTEGRITY: an optional vessel link must belong to the
    // SAME organization.
    vesselOrgFk: foreignKey({
      columns: [t.vesselId, t.organizationId],
      foreignColumns: [vessels.id, vessels.organizationId],
      name: "voyages_vessel_org_fk",
    }),
    // CROSS-TENANT INTEGRITY: an optional contract link must belong to the
    // SAME organization.
    contractOrgFk: foreignKey({
      columns: [t.contractId, t.organizationId],
      foreignColumns: [contracts.id, contracts.organizationId],
      name: "voyages_contract_org_fk",
    }),
  })
);


/**
 * VOYAGE PORT CALL — a single visit to one port within a voyage.
 * ---------------------------------------------------------------------------
 * effectiveTimezone is SNAPSHOTTED at creation (F28): it resolves from
 * Port.defaultTimezone, falling back to "UTC" only when the port has none.
 * CompanyConfiguration.defaultTimezone is application/display-only and NEVER
 * participates here. Snapshotting matters because correcting a port's
 * timezone later must not silently shift historical calculations.
 *
 * sequence (PO10) is the intended visiting order, never a timestamp. Unique
 * within a voyage at the database level; gaps are allowed.
 *
 * status (PO9) is purely administrative — it never encodes NOR, berthing,
 * commencement or departure. Those are OperationalEvent facts (Phase 5).
 *
 * contractLaytimeTermId (PO11) is NOT resolved automatically at creation:
 * cargo context lives on CargoPlan, which does not exist yet at that point.
 * It is set only by an explicit resolve or override action.
 * ---------------------------------------------------------------------------
 */
export const portCallStatusEnum = pgEnum("port_call_status", [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

export const voyagePortCalls = pgTable(
  "voyage_port_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    voyageId: uuid("voyage_id").notNull(),
    portId: uuid("port_id").notNull(),
    facilityId: uuid("facility_id"),
    function: contractFunctionEnum("function").notNull(),
    sequence: integer("sequence").notNull(),
    status: portCallStatusEnum("status").notNull().default("ACTIVE"),
    effectiveTimezone: text("effective_timezone").notNull(),
    contractLaytimeTermId: uuid("contract_laytime_term_id"),
    // Per-vessel override of the term's laytime-end event (e.g. documents
    // took very long to be signed on this call). Null = use the term default.
    laytimeEndOverride: text("laytime_end_override"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("voyage_port_calls_org_idx").on(t.organizationId),
    voyageIdx: index("voyage_port_calls_voyage_idx").on(t.voyageId),
    // PO10: sequence is unique within a voyage, enforced by the database.
    voyageSequenceUniqueIdx: uniqueIndex(
      "voyage_port_calls_voyage_sequence_unique_idx"
    ).on(t.voyageId, t.sequence),
    // Composite unique target so CargoPlan (and later OperationalEvent,
    // Stoppage, ShiftPerformance) can hold a tenant-safe composite FK here.
    orgIdCompositeIdx: unique("voyage_port_calls_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    // CROSS-TENANT INTEGRITY on every reference.
    voyageOrgFk: foreignKey({
      columns: [t.voyageId, t.organizationId],
      foreignColumns: [voyages.id, voyages.organizationId],
      name: "voyage_port_calls_voyage_org_fk",
    }).onDelete("cascade"),
    portOrgFk: foreignKey({
      columns: [t.portId, t.organizationId],
      foreignColumns: [ports.id, ports.organizationId],
      name: "voyage_port_calls_port_org_fk",
    }),
    facilityOrgFk: foreignKey({
      columns: [t.facilityId, t.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
      name: "voyage_port_calls_facility_org_fk",
    }),
    termOrgFk: foreignKey({
      columns: [t.contractLaytimeTermId, t.organizationId],
      foreignColumns: [
        contractLaytimeTerms.id,
        contractLaytimeTerms.organizationId,
      ],
      name: "voyage_port_calls_term_org_fk",
    }),
  })
);

/**
 * CARGO PLAN — what is meant to be loaded or discharged at a port call.
 * ---------------------------------------------------------------------------
 * A port call may carry several cargo plans (1─* per the architecture).
 * That matters for PO11: term applicability needs exactly one cargo, so a
 * port call with more than one plan cannot be resolved automatically and
 * the resolve action reports MULTIPLE_CARGO_CONTEXTS rather than guessing.
 *
 * Quantities are numeric with no invented precision, matching the
 * commercial layer. actualQuantityMt is null until the operation is done.
 * ---------------------------------------------------------------------------
 */
export const cargoPlans = pgTable(
  "cargo_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    portCallId: uuid("port_call_id").notNull(),
    cargoId: uuid("cargo_id").notNull(),
    plannedQuantityMt: numeric("planned_quantity_mt").notNull(),
    actualQuantityMt: numeric("actual_quantity_mt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("cargo_plans_org_idx").on(t.organizationId),
    portCallIdx: index("cargo_plans_port_call_idx").on(t.portCallId),
    // One plan per cargo per port call: two rows for the same cargo on the
    // same call would be a data-entry mistake, not a real second parcel.
    portCallCargoUniqueIdx: uniqueIndex(
      "cargo_plans_port_call_cargo_unique_idx"
    ).on(t.portCallId, t.cargoId),
    // CROSS-TENANT INTEGRITY on both references.
    portCallOrgFk: foreignKey({
      columns: [t.portCallId, t.organizationId],
      foreignColumns: [voyagePortCalls.id, voyagePortCalls.organizationId],
      name: "cargo_plans_port_call_org_fk",
    }).onDelete("cascade"),
    cargoOrgFk: foreignKey({
      columns: [t.cargoId, t.organizationId],
      foreignColumns: [cargoes.id, cargoes.organizationId],
      name: "cargo_plans_cargo_org_fk",
    }),
  })
);
