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

/** The eight frozen engine event semantics (F8). No other value is engine-meaningful. */
export type EngineEventSemantic =
  | "NOR_TENDERED"
  | "NOR_ACCEPTED"
  | "BERTHED"
  | "OPS_COMMENCED"
  | "OPS_COMPLETED"
  | "DEPARTED"
  | "WEATHER_START"
  | "WEATHER_END";

const ENGINE_EVENT_SEMANTICS: readonly EngineEventSemantic[] = [
  "NOR_TENDERED",
  "NOR_ACCEPTED",
  "BERTHED",
  "OPS_COMMENCED",
  "OPS_COMPLETED",
  "DEPARTED",
  "WEATHER_START",
  "WEATHER_END",
];

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
export function resolveRequiredEvent(
  events: EngineEvent[],
  semantic: EngineEventSemantic,
  contextCode: string
): Date {
  const matches = events.filter((e) => e.semantic === semantic);

  if (matches.length === 0) {
    throw new CalculationRefused(
      `${contextCode}_EVENT_MISSING`,
      `Cannot calculate: the required ${semantic} event has not been recorded for this port call.`
    );
  }
  if (matches.length > 1) {
    throw new CalculationRefused(
      `${contextCode}_EVENT_AMBIGUOUS`,
      `Cannot calculate: more than one live ${semantic} event exists, and choosing one would be a guess.`
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
 *   MORNING_NOR_1400  — "if the notice is tendered before noon, laytime
 *                       commences at 14:00 local the same day". Evidenced by
 *                       the real MY FELLAS / YUFIX calculations
 *                       ("If NOR before 12:00 time counts 14:00 same day").
 *                       Only the before-noon branch is defined; a notice at or
 *                       after noon is a withheld semantic and is refused.
 */
export type CommencementTimeRule = "AT_EVENT" | "MORNING_NOR_1400";

/**
 * Applies the commencement time-of-day rule to the basis-event instant,
 * returning when counting begins. Pure; the zone is passed in explicitly.
 */
export function applyCommencementTimeRule(
  basisInstant: Date,
  rule: CommencementTimeRule,
  timeZone: string
): Date {
  if (rule === "AT_EVENT") return basisInstant;

  // MORNING_NOR_1400
  const p = getLocalParts(basisInstant, timeZone);
  if (p.hour >= 12) {
    throw new CalculationRefused(
      "COMMENCEMENT_AFTER_NOON_UNDEFINED",
      "Cannot calculate: this commencement rule is defined only for a notice tendered before noon; the at/after-noon basis is not defined for this term."
    );
  }
  return instantFromLocal(
    { year: p.year, month: p.month, day: p.day, hour: 14, minute: 0, second: 0 },
    timeZone
  );
}
