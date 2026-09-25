/**
 * COMMENCEMENT — determining when laytime commences (Phase 6, pipeline step 2).
 *
 * Commencement is event-driven (B1). The term's `commencementRule` names the
 * operational-event semantic laytime commences from; the engine finds the
 * corresponding LIVE event and takes its instant. It does NOT interpret free
 * text, invent a basis, or fall back to another event: the supported
 * vocabulary is exactly the frozen engine semantics (F8), and anything else —
 * an unrecognised basis, a missing event, or an ambiguous one — is a refusal,
 * not a guess (Q1/Q3 baseline: no silent fallback from NOR_ACCEPTED to
 * NOR_TENDERED, no invented hierarchy).
 *
 * The pure engine takes no DB: the caller loads the port call's LIVE events
 * (dropping any superseded by a Phase 5 correction), maps each to its system
 * semantic, and injects them here.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import { CalculationRefused } from "./refuse";
import { getLocalParts, instantFromLocal } from "./timezone";

/**
 * The engine event semantics (F8). No other value is engine-meaningful.
 * F8 amended 2026-09-24 (evidence: MY FELLAS loading calculation counts to
 * "documents on board"; Adel: loads normally end at lashing completed):
 * LASHING_COMPLETED and DOCUMENTS_ON_BOARD were added as laytime-END events.
 */
export type EngineEventSemantic =
  | "NOR_TENDERED"
  | "NOR_ACCEPTED"
  | "BERTHED"
  | "OPS_COMMENCED"
  | "OPS_COMPLETED"
  | "LASHING_COMPLETED"
  | "DOCUMENTS_ON_BOARD"
  | "DEPARTED"
  | "WEATHER_START"
  | "WEATHER_END";

const ENGINE_EVENT_SEMANTICS: readonly EngineEventSemantic[] = [
  "NOR_TENDERED",
  "NOR_ACCEPTED",
  "BERTHED",
  "OPS_COMMENCED",
  "OPS_COMPLETED",
  "LASHING_COMPLETED",
  "DOCUMENTS_ON_BOARD",
  "DEPARTED",
  "WEATHER_START",
  "WEATHER_END",
];

/** The events that may end laytime (the countable window END). Bounded. */
export type LaytimeEndEvent = "OPS_COMPLETED" | "LASHING_COMPLETED" | "DOCUMENTS_ON_BOARD";

export const LAYTIME_END_EVENT_VALUES: readonly LaytimeEndEvent[] = [
  "OPS_COMPLETED",
  "LASHING_COMPLETED",
  "DOCUMENTS_ON_BOARD",
];

export function isLaytimeEndEvent(v: unknown): v is LaytimeEndEvent {
  return (LAYTIME_END_EVENT_VALUES as readonly unknown[]).includes(v);
}

/** An operational event resolved to its engine semantic, already live-filtered. */
export type EngineEvent = {
  semantic: EngineEventSemantic;
  occurredAt: Date;
};

/** True when `value` is one of the eight frozen engine semantics. */
export function isEngineEventSemantic(
  value: string
): value is EngineEventSemantic {
  return (ENGINE_EVENT_SEMANTICS as readonly string[]).includes(value);
}

/**
 * Resolves the single live event carrying `semantic`, or refuses.
 *
 * `contextCode` prefixes the refusal code so the caller can tell WHICH stage
 * needed the event (e.g. "COMMENCEMENT", "TURN_TIME"). Refuses when no event
 * carries the semantic (the required commercial input is missing) or when
 * more than one does (choosing one would invent a fact — consistent with the
 * resolver's no-silent-tie-break rule, F15).
 */
/** Readable names for refusal messages (the UI shows these to the user). */
const SEMANTIC_LABEL: Record<EngineEventSemantic, string> = {
  NOR_TENDERED: "NOR tendered",
  NOR_ACCEPTED: "NOR accepted",
  BERTHED: "Berthed",
  OPS_COMMENCED: "Operations commenced",
  OPS_COMPLETED: "Operations completed",
  LASHING_COMPLETED: "Lashing completed",
  DOCUMENTS_ON_BOARD: "Documents on board",
  DEPARTED: "Departed",
  WEATHER_START: "Weather stoppage started",
  WEATHER_END: "Weather stoppage ended",
};

export function semanticLabel(semantic: EngineEventSemantic): string {
  return SEMANTIC_LABEL[semantic];
}

export function resolveRequiredEvent(
  events: EngineEvent[],
  semantic: EngineEventSemantic,
  contextCode: string
): Date {
  const matches = events.filter((e) => e.semantic === semantic);

  if (matches.length === 0) {
    throw new CalculationRefused(
      `${contextCode}_EVENT_MISSING`,
      `Cannot calculate: the "${SEMANTIC_LABEL[semantic]}" event has not been recorded for this port call. Record it, or choose another laytime end.`
    );
  }
  if (matches.length > 1) {
    throw new CalculationRefused(
      `${contextCode}_EVENT_AMBIGUOUS`,
      `Cannot calculate: more than one "${SEMANTIC_LABEL[semantic]}" event is recorded, and choosing one would be a guess.`
    );
  }
  return matches[0].occurredAt;
}

/**
 * Determines the commencement instant from the configured basis.
 *
 * `commencementBasis` is the term's `commencementRule` value (stored as free
 * text in Phase 3). Only the eight frozen semantics are recognised; any other
 * value is refused rather than interpreted.
 */
export function determineCommencement(
  events: EngineEvent[],
  commencementBasis: string
): Date {
  if (!isEngineEventSemantic(commencementBasis)) {
    throw new CalculationRefused(
      "COMMENCEMENT_BASIS_UNRECOGNISED",
      `Cannot calculate: the commencement basis "${commencementBasis}" is not a recognised operational-event semantic.`
    );
  }
  return resolveRequiredEvent(events, commencementBasis, "COMMENCEMENT");
}

/**
 * The time-of-day rule that maps the commencement-basis event to when counting
 * actually begins. A bounded vocabulary — each value is a specific contractual
 * convention validated from real charterparty evidence, never a free numeric.
 *
 *   AT_EVENT          — laytime commences at the basis event instant itself
 *                       (the default; preserves the pre-existing behaviour).
 *   MORNING_NOR_1400  — the GENCON 1994 clause 6(c) convention as amended in
 *                       Adel's charter party (printed 13:00 → 14:00, printed
 *                       06:00 → 08:00):
 *                         - notice given up to AND INCLUDING 12:00 local →
 *                           laytime commences 14:00 local the same day;
 *                         - notice given after 12:00 local → laytime
 *                           commences 08:00 local on the NEXT WORKING DAY.
 *                       Evidence: the clause text (supplied 2026-09-23) plus
 *                       the MY FELLAS / YUFIX calculations ("If NOR before
 *                       12:00 time counts 14:00 same day"). The stored value
 *                       keeps its original name so existing terms need no
 *                       migration; before this, the after-noon branch was
 *                       refused, so no previously computed result changes.
 *
 * "Working day" is read from the rule set's own calendar: a local day that is
 * neither an excluded weekday nor a holiday date. The clause's "during office
 * hours" condition is about whether the notice was validly given; the engine
 * takes the recorded notice instant as given and does not assess office hours.
 */
export type CommencementTimeRule = "AT_EVENT" | "MORNING_NOR_1400";

/** The local clock times of the amended clause 6(c). Fixed by the rule value. */
const NOON_CUTOFF = { hour: 12, minute: 0 };
const SAME_DAY_START_HOUR = 14;
const NEXT_WORKING_DAY_START_HOUR = 8;

/** Guard against a calendar with no working day at all (e.g. every weekday excluded). */
const MAX_WORKING_DAY_SEARCH = 366;

/** The calendar a "next working day" is resolved against. */
export type CommencementCalendar = {
  /** Excluded weekdays (0=Sun … 6=Sat), from the rule set. */
  excludedWeekdays: readonly number[];
  /** Holiday local dates (YYYY-MM-DD) that the rule set excludes. */
  holidayDates: ReadonlySet<string>;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The first local calendar day strictly after (year, month, day) that is a
 * working day under `calendar`. Pure calendar arithmetic — no zone involved.
 */
function nextWorkingDay(
  year: number,
  month: number,
  day: number,
  calendar: CommencementCalendar
): { year: number; month: number; day: number } {
  for (let k = 1; k <= MAX_WORKING_DAY_SEARCH; k++) {
    const d = new Date(Date.UTC(year, month - 1, day + k));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dd = d.getUTCDate();
    const key = `${y}-${pad2(m)}-${pad2(dd)}`;
    if (calendar.excludedWeekdays.includes(d.getUTCDay())) continue;
    if (calendar.holidayDates.has(key)) continue;
    return { year: y, month: m, day: dd };
  }
  throw new CalculationRefused(
    "COMMENCEMENT_NO_WORKING_DAY",
    "Cannot calculate: the rule set's calendar has no working day to start laytime on."
  );
}

/**
 * Applies the commencement time-of-day rule to the basis-event instant,
 * returning when counting begins. Pure; the zone and calendar are passed in.
 *
 * `calendar` is needed only for the after-noon branch; if it is required and
 * not supplied the calculation is refused rather than assuming a calendar.
 */
export function applyCommencementTimeRule(
  basisInstant: Date,
  rule: CommencementTimeRule,
  timeZone: string,
  calendar?: CommencementCalendar
): Date {
  if (rule === "AT_EVENT") return basisInstant;

  // MORNING_NOR_1400 — amended GENCON 6(c)
  const p = getLocalParts(basisInstant, timeZone);
  // "Up to and including 12.00 hours" — read at the minute precision the
  // clause and SOFs are written in, so 12:00 (any seconds) is still morning.
  const atOrBeforeNoon =
    p.hour < NOON_CUTOFF.hour ||
    (p.hour === NOON_CUTOFF.hour && p.minute === NOON_CUTOFF.minute);

  if (atOrBeforeNoon) {
    return instantFromLocal(
      { year: p.year, month: p.month, day: p.day, hour: SAME_DAY_START_HOUR, minute: 0, second: 0 },
      timeZone
    );
  }

  if (calendar === undefined) {
    throw new CalculationRefused(
      "COMMENCEMENT_RULE_NEEDS_CALENDAR",
      "Cannot calculate: a notice given after 12:00 starts laytime on the next working day, which needs the rule set's calendar."
    );
  }
  const next = nextWorkingDay(p.year, p.month, p.day, calendar);
  return instantFromLocal(
    { ...next, hour: NEXT_WORKING_DAY_START_HOUR, minute: 0, second: 0 },
    timeZone
  );
}
