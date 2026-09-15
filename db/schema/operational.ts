import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  unique,
  index,
  numeric,
  date,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./platform";
import {
  operationalEventTypes,
  stoppageReasons,
  facilities,
  cargoes,
} from "./master-data";
import { voyagePortCalls } from "./voyage";

/**
 * OPERATIONAL LAYER — Phase 5
 * ---------------------------------------------------------------------------
 * What actually happened at a port call. Everything here hangs off
 * portCallId: the port call is the operational anchor, and it carries the
 * effectiveTimezone the engine will classify these facts against.
 *
 * Nothing in this file calculates anything. Phase 6 reads these rows; it
 * does not find decisions already made for it here.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// OPERATIONAL EVENT — a point in time.
//
// APPEND-ONLY. A recorded event is never edited and never deleted: a
// correction is a NEW row, and the old one is marked as superseded by it.
// That is what makes the record defensible months later — the question
// "what did we know, and when did we know it" stays answerable.
//
// occurredAt is when the thing happened; recordedAt is when someone wrote
// it down. They are deliberately separate, because a NOR tendered at 03:00
// and entered at 09:00 is an ordinary situation, not an error.
//
// Only OperationalEventType.systemSemantic can influence the engine (F8).
// An event whose type carries no semantic is informational: it appears on
// the timeline and moves nothing.
// ---------------------------------------------------------------------------
export const operationalEvents = pgTable(
  "operational_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    portCallId: uuid("port_call_id").notNull(),
    eventTypeId: uuid("event_type_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.id),
    supersededByEventId: uuid("superseded_by_event_id"),
  },
  (t) => ({
    orgIdx: index("operational_events_org_idx").on(t.organizationId),
    portCallIdx: index("operational_events_port_call_idx").on(t.portCallId),
    // The engine reads events in chronological order per port call.
    portCallOccurredIdx: index("operational_events_port_call_occurred_idx").on(
      t.portCallId,
      t.occurredAt
    ),
    // Composite unique target so a superseding event can point back here
    // tenant-safely.
    orgIdCompositeIdx: unique("operational_events_id_org_unique").on(
      t.id,
      t.organizationId
    ),
    // Guards ONE of the two supersession invariants: a replacement event
    // can be pointed at by at most one original. Two originals both
    // naming the same replacement would leave "which event does this
    // correct" without an answer.
    //
    // The OTHER invariant — that an already-superseded event cannot be
    // superseded a second time, which is what stops A->B and A->C
    // branching off one original — is enforced in the action layer
    // (correctOperationalEvent returns INVALID_STATE), NOT here. A direct
    // UPDATE could still re-point an existing supersededByEventId.
    supersededByUniqueIdx: uniqueIndex(
      "operational_events_superseded_by_unique_idx"
    )
      .on(t.supersededByEventId)
      .where(sql`${t.supersededByEventId} is not null`),
    // An event cannot supersede itself.
    noSelfSupersedeCheck: check(
      "operational_events_no_self_supersede_check",
      sql`superseded_by_event_id is null or superseded_by_event_id <> id`
    ),
    // CROSS-TENANT INTEGRITY on every reference.
    portCallOrgFk: foreignKey({
      columns: [t.portCallId, t.organizationId],
      foreignColumns: [voyagePortCalls.id, voyagePortCalls.organizationId],
      name: "operational_events_port_call_org_fk",
    }).onDelete("cascade"),
    eventTypeOrgFk: foreignKey({
      columns: [t.eventTypeId, t.organizationId],
      foreignColumns: [
        operationalEventTypes.id,
        operationalEventTypes.organizationId,
      ],
      name: "operational_events_event_type_org_fk",
    }),
    supersededByOrgFk: foreignKey({
      columns: [t.supersededByEventId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
      name: "operational_events_superseded_by_org_fk",
    }),
  })
);

// ---------------------------------------------------------------------------
// STOPPAGE — a time span during which work stopped.
//
// Interval semantics are [startTime, endTime), carried over unchanged from
// the previous system: adjacent stoppages are legitimate (11:00 ending one
// and starting the next is a shift handover, not an overlap), while any
// genuine overlap is rejected. A null endTime means the stoppage is still
// running, and is treated as unbounded above.
//
// INTEGRITY IS ENFORCED IN THE MIGRATION, NOT HERE. Drizzle 0.45.2 has no
// way to declare a PostgreSQL EXCLUDE constraint, so
// `stoppages_no_overlap` lives in migration 0008 as raw SQL:
//
//   EXCLUDE USING gist (
//     port_call_id WITH =,
//     tstzrange(start_time, end_time, '[)') WITH &&
//   )
//
// That single constraint enforces BOTH rules: no overlapping stoppages on
// a port call, and at most one open stoppage (two unbounded intervals
// always overlap). It requires the btree_gist extension, enabled in the
// same migration. The action layer checks the same rule first, so users
// get a readable message; the constraint is the authority under
// concurrency, where a pre-check alone would race.
//
// PO13: endTime must be strictly AFTER startTime. A zero-length stoppage
// has no commercial meaning, and PostgreSQL treats tstzrange(x, x, '[)')
// as EMPTY — empty ranges overlap nothing, so such rows would slip past
// the EXCLUDE constraint entirely and could even be duplicated inside an
// existing stoppage. The CHECK below closes that hole.
// ---------------------------------------------------------------------------
export const stoppages = pgTable(
  "stoppages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    portCallId: uuid("port_call_id").notNull(),
    reasonId: uuid("reason_id").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }),
    notes: text("notes"),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("stoppages_org_idx").on(t.organizationId),
    portCallIdx: index("stoppages_port_call_idx").on(t.portCallId),
    portCallStartIdx: index("stoppages_port_call_start_idx").on(
      t.portCallId,
      t.startTime
    ),
    // PO13 — see the file comment above on why this is strict.
    endAfterStartCheck: check(
      "stoppages_end_after_start_check",
      sql`end_time is null or end_time > start_time`
    ),
    portCallOrgFk: foreignKey({
      columns: [t.portCallId, t.organizationId],
      foreignColumns: [voyagePortCalls.id, voyagePortCalls.organizationId],
      name: "stoppages_port_call_org_fk",
    }).onDelete("cascade"),
    reasonOrgFk: foreignKey({
      columns: [t.reasonId, t.organizationId],
      foreignColumns: [stoppageReasons.id, stoppageReasons.organizationId],
      name: "stoppages_reason_org_fk",
    }),
  })
);

// ---------------------------------------------------------------------------
// SHIFT PERFORMANCE — how much cargo moved, and when.
//
// F24, frozen: this NEVER affects laytime countability. The engine reads
// it only to know whether work occurred in a window (the EIU distinction),
// and tonnage never moves the clock. Nothing here carries a countability
// flag, a commencement hint, or an event semantic, and nothing should be
// added later that does.
//
// shiftDate is a DATE, not a timestamp: a shift belongs to an operational
// day at the port, and that day is read in the port call's
// effectiveTimezone (F18/F28) rather than in UTC.
// ---------------------------------------------------------------------------
export const shiftPerformances = pgTable(
  "shift_performances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    portCallId: uuid("port_call_id").notNull(),
    facilityId: uuid("facility_id"),
    cargoId: uuid("cargo_id").notNull(),
    shiftDate: date("shift_date").notNull(),
    crane: text("crane"),
    operationType: text("operation_type"),
    quantityMt: numeric("quantity_mt").notNull(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("shift_performances_org_idx").on(t.organizationId),
    portCallIdx: index("shift_performances_port_call_idx").on(t.portCallId),
    portCallDateIdx: index("shift_performances_port_call_date_idx").on(
      t.portCallId,
      t.shiftDate
    ),
    portCallOrgFk: foreignKey({
      columns: [t.portCallId, t.organizationId],
      foreignColumns: [voyagePortCalls.id, voyagePortCalls.organizationId],
      name: "shift_performances_port_call_org_fk",
    }).onDelete("cascade"),
    facilityOrgFk: foreignKey({
      columns: [t.facilityId, t.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
      name: "shift_performances_facility_org_fk",
    }),
    cargoOrgFk: foreignKey({
      columns: [t.cargoId, t.organizationId],
      foreignColumns: [cargoes.id, cargoes.organizationId],
      name: "shift_performances_cargo_org_fk",
    }),
  })
);
