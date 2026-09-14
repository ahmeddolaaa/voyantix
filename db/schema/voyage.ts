import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  unique,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./platform";
import { vessels } from "./master-data";
import { contracts } from "./commercial";

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