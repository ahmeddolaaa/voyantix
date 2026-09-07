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
  boolean,
  date,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./platform";

/**
 * MASTER DATA LAYER — Phase 2
 * ---------------------------------------------------------------------------
 * Org-scoped reference data. Admin-managed. Never mixed with commercial,
 * voyage, operational or calculated layers.
 * ---------------------------------------------------------------------------
 */

export const entityStatusEnum = pgEnum("entity_status", ["active", "inactive"]);

/**
 * Fixed engine vocabulary. Only these values may drive laytime engine
 * behaviour (Pipeline step 2+). Enforced at the database layer via a
 * CHECK constraint on operationalEventTypes, not just app validation.
 */
export const OPERATIONAL_EVENT_SEMANTICS = [
  "NOR_TENDERED",
  "NOR_ACCEPTED",
  "BERTHED",
  "OPS_COMMENCED",
  "OPS_COMPLETED",
  "DEPARTED",
  "WEATHER_START",
  "WEATHER_END",
] as const;
export type OperationalEventSemantic = (typeof OPERATIONAL_EVENT_SEMANTICS)[number];

// ---------------------------------------------------------------------------
// VESSEL — optional master link. Voyage.vesselName (Phase 4) remains the
// operational truth; editing a master Vessel row never rewrites historical
// Voyage.vesselName values.
// ---------------------------------------------------------------------------
export const vessels = pgTable(
  "vessels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    imo: text("imo"),
    dwt: integer("dwt"),
    flag: text("flag"),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("vessels_org_idx").on(t.organizationId),
    orgNameIdx: index("vessels_org_name_idx").on(t.organizationId, t.name),
    // IMO unique within org, only when present. Name is deliberately NOT
    // unique — vessel names collide across the industry.
    imoUniqueIdx: uniqueIndex("vessels_org_imo_unique_idx")
      .on(t.organizationId, sql`lower(trim(${t.imo}))`)
      .where(sql`${t.imo} is not null`),
  })
);

// ---------------------------------------------------------------------------
// HOLIDAY CALENDAR + HOLIDAY — customer-owned. Not versioned: historical
// safety comes from LaytimeCalculation.resolvedRulesJson (Phase 7), not
// from calendar/holiday version tables. Editing a Holiday NEVER mutates
// an existing calculation or finalized statement.
// ---------------------------------------------------------------------------
export const holidayCalendars = pgTable(
  "holiday_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("holiday_calendars_org_idx").on(t.organizationId),
    // Composite unique target so Port can hold a tenant-safe composite FK
    // into this table (see ports.holidayCalendarOrgFk below). Uses an
    // inline table CONSTRAINT (not a separate CREATE UNIQUE INDEX) so it
    // exists at CREATE TABLE time, before any ALTER TABLE ... ADD
    // CONSTRAINT FOREIGN KEY statement that references it runs.
    orgIdCompositeIdx: unique("holiday_calendars_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    nameUniqueIdx: uniqueIndex("holiday_calendars_org_name_unique_idx").on(
      t.organizationId,
      sql`lower(trim(${t.name}))`
    ),
  })
);

// Holiday has no status/lifecycle: it is a line item inside a calendar, not
// an independently referenced lookup. Edits after use are safe by design
// (see file header).
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    holidayCalendarId: uuid("holiday_calendar_id")
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    label: text("label").notNull(),
  },
  (t) => ({
    calendarIdx: index("holidays_calendar_idx").on(t.holidayCalendarId),
    calendarDateUniqueIdx: uniqueIndex("holidays_calendar_date_unique_idx").on(
      t.holidayCalendarId,
      t.date
    ),
  })
);

// ---------------------------------------------------------------------------
// PORT
// ---------------------------------------------------------------------------
export const ports = pgTable(
  "ports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    country: text("country").notNull(),
    unlocode: text("unlocode"),
    defaultTimezone: text("default_timezone").notNull(),
    defaultHolidayCalendarId: uuid("default_holiday_calendar_id"),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("ports_org_idx").on(t.organizationId),
    // Composite unique target so Facility can hold a tenant-safe composite
    // FK into this table. Inline table CONSTRAINT — see holidayCalendars
    // comment above for why this can't be a separate uniqueIndex.
    orgIdCompositeIdx: unique("ports_id_org_unique").on(t.id, t.organizationId),
    nameUniqueIdx: uniqueIndex("ports_org_name_unique_idx").on(
      t.organizationId,
      sql`lower(trim(${t.name}))`
    ),
    unlocodeUniqueIdx: uniqueIndex("ports_org_unlocode_unique_idx")
      .on(t.organizationId, sql`lower(trim(${t.unlocode}))`)
      .where(sql`${t.unlocode} is not null`),
    // CROSS-TENANT INTEGRITY: a Port can only reference a HolidayCalendar
    // belonging to the SAME organization. Enforced by Postgres, not just
    // application code.
    holidayCalendarOrgFk: foreignKey({
      columns: [t.defaultHolidayCalendarId, t.organizationId],
      foreignColumns: [holidayCalendars.id, holidayCalendars.organizationId],
      name: "ports_holiday_calendar_org_fk",
    }),
  })
);

// ---------------------------------------------------------------------------
// FACILITY — child of Port. Replaces "Factory".
// ---------------------------------------------------------------------------
export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    portId: uuid("port_id").notNull(),
    name: text("name").notNull(),
    code: text("code"),
    type: text("type"),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("facilities_org_idx").on(t.organizationId),
    portIdx: index("facilities_port_idx").on(t.portId),
    nameUniqueIdx: uniqueIndex("facilities_port_name_unique_idx").on(
      t.portId,
      sql`lower(trim(${t.name}))`
    ),
    codeUniqueIdx: uniqueIndex("facilities_port_code_unique_idx")
      .on(t.portId, sql`lower(trim(${t.code}))`)
      .where(sql`${t.code} is not null`),
    // CROSS-TENANT INTEGRITY: a Facility can only reference a Port
    // belonging to the SAME organization.
    portOrgFk: foreignKey({
      columns: [t.portId, t.organizationId],
      foreignColumns: [ports.id, ports.organizationId],
      name: "facilities_port_org_fk",
    }).onDelete("cascade"),
  })
);

// ---------------------------------------------------------------------------
// CARGO
// ---------------------------------------------------------------------------
export const cargoes = pgTable(
  "cargoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    grade: text("grade"),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("cargoes_org_idx").on(t.organizationId),
    nameUniqueIdx: uniqueIndex("cargoes_org_name_unique_idx").on(
      t.organizationId,
      sql`lower(trim(${t.name}))`
    ),
  })
);

// ---------------------------------------------------------------------------
// STOPPAGE REASON — no defaultCountability. A missing ContractStoppageRule
// must raise an exception in the engine (Phase 6), never silently resolve
// via a master-data default. This table stays neutral.
// ---------------------------------------------------------------------------
export const stoppageReasons = pgTable(
  "stoppage_reasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isWeatherRelated: boolean("is_weather_related").notNull().default(false),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("stoppage_reasons_org_idx").on(t.organizationId),
    nameUniqueIdx: uniqueIndex("stoppage_reasons_org_name_unique_idx").on(
      t.organizationId,
      sql`lower(trim(${t.name}))`
    ),
  })
);

// ---------------------------------------------------------------------------
// OPERATIONAL EVENT TYPE — bridges master data to the laytime engine.
// isProtected rows represent fixed engine semantics: code and
// systemSemantic are immutable through normal admin operations, the row
// can never be deactivated or deleted, and duplicate semantics within one
// org are rejected. Only the label may be edited. All of this is enforced
// at the database layer via CHECK constraints below, not just app code.
// ---------------------------------------------------------------------------
export const operationalEventTypes = pgTable(
  "operational_event_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    systemSemantic: text("system_semantic"),
    isProtected: boolean("is_protected").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("operational_event_types_org_idx").on(t.organizationId),
    codeUniqueIdx: uniqueIndex("operational_event_types_org_code_unique_idx").on(
      t.organizationId,
      sql`lower(trim(${t.code}))`
    ),
    semanticUniqueIdx: uniqueIndex("operational_event_types_org_semantic_unique_idx")
      .on(t.organizationId, t.systemSemantic)
      .where(sql`${t.systemSemantic} is not null`),
    // Protected rows MUST carry a semantic; unprotected rows MUST NOT.
    protectedSemanticCheck: check(
      "operational_event_types_protected_semantic_check",
      sql`(is_protected = true and system_semantic is not null) or (is_protected = false and system_semantic is null)`
    ),
    // Protected rows can never be inactive — the engine always needs all
    // eight semantics available.
    protectedActiveCheck: check(
      "operational_event_types_protected_active_check",
      sql`(is_protected = false) or (is_protected = true and status = 'active')`
    ),
    // Semantic value, when present, must belong to the fixed engine
    // vocabulary — a customer can never invent an engine-controlling value.
    semanticVocabularyCheck: check(
      "operational_event_types_semantic_vocabulary_check",
      sql`system_semantic is null or system_semantic in (
        'NOR_TENDERED','NOR_ACCEPTED','BERTHED','OPS_COMMENCED',
        'OPS_COMPLETED','DEPARTED','WEATHER_START','WEATHER_END'
      )`
    ),
  })
);
