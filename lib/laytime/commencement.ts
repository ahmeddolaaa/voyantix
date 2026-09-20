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
