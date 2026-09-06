import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * PLATFORM LAYER — Phase 1
 * ---------------------------------------------------------------------------
 * Tenancy, identity and authorization. Everything else in the product is
 * built inside this boundary.
 *
 * Key architectural rules (Phase 2 FINAL §N):
 *   - `User` is NOT organization-scoped. A person may serve several
 *     customer companies; identity is global, access is granted per
 *     organization through `Membership`.
 *   - `Session` is the sole authority for tenant scope. `organizationId`
 *     is never accepted from client input for authorization purposes.
 *   - Roles are a fixed set, not a configurable matrix. This is a
 *     deliberate scope decision, revisitable without redesign.
 * ---------------------------------------------------------------------------
 */

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("organizations_slug_idx").on(t.slug),
  })
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  })
);

/**
 * Fixed role set. Seeded, not customer-editable in v1.
 *   admin       — full access including administration and master data
 *   commercial  — contracts, terms, statements, finalize
 *   operations  — voyages, port calls, events, stoppages
 *   viewer      — read only
 */
export const ROLES = ["admin", "commercial", "operations", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userOrgIdx: uniqueIndex("memberships_user_org_idx").on(
      t.userId,
      t.organizationId
    ),
    orgIdx: index("memberships_org_idx").on(t.organizationId),
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // opaque random token, httpOnly cookie
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid("active_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
  })
);

/**
 * COMPANY CONFIGURATION
 *
 * `defaultTimezone` is an APPLICATION DISPLAY DEFAULT ONLY.
 * It must never be used by the laytime engine — day-based contractual
 * rules resolve against PortCall.effectiveTimezone (Phase 2 FINAL §D).
 */
export const companyConfigurations = pgTable(
  "company_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    voyageReferencePattern: text("voyage_reference_pattern")
      .notNull()
      .default("VOY-{YY}{SEQ:4}"),
    defaultTimezone: text("default_timezone").notNull().default("UTC"),
    defaultExcludedWeekdays: jsonb("default_excluded_weekdays")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: uniqueIndex("company_configurations_org_idx").on(t.organizationId),
  })
);

/**
 * Transactional reference allocation. One row per (organization, scope).
 * Incremented inside the same transaction that creates the voyage, so
 * concurrent creation cannot produce duplicate references.
 */
export const referenceSequences = pgTable(
  "reference_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // e.g. "voyage:2026"
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => ({
    orgScopeIdx: uniqueIndex("reference_sequences_org_scope_idx").on(
      t.organizationId,
      t.scope
    ),
  })
);

/**
 * AUDIT — append-only. Records actor and before/after state
 * (Phase 2 FINAL §42).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgEntityIdx: index("audit_log_org_entity_idx").on(
      t.organizationId,
      t.entityType,
      t.entityId
    ),
  })
);
