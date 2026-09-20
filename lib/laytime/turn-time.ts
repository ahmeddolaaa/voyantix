/**
 * TURN TIME — the grace period before laytime counts (Phase 6, pipeline step 3).
 *
 * Turn time is a contract value on ContractLaytimeTerm (turnTimeHours,
 * turnTimeTrigger) and a DISTINCT engine stage: it produces a VISIBLE,
 * NON-COUNTABLE interval, running for the configured duration from the
 * configured trigger event. It is NOT modelled as EIU and carries no generic
 * usage-policy abstraction (Q2 baseline).
 *
 * The trigger is an operational-event semantic (like the commencement basis).
 * When a duration is configured but the trigger is undefined, unrecognised,
 * or its event is missing, the engine REFUSES rather than guessing — the exact
 * trigger semantics are contract configuration, not a product default.
 *
 * Duration is elapsed hours (the literal meaning of the configured value; the
 * reference calculations show turn time as a straight hour block). Whether
 * turn time should instead be measured in "laytime hours" is a deeper
 * semantic not established by the current architecture, so it is not assumed
 * here.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import { CalculationRefused } from "./refuse";
import {
  resolveRequiredEvent,
  isEngineEventSemantic,
  type EngineEvent,
} from "./commencement";
import type { RawInterval } from "./partition";

export type TurnTime = {
  /** The visible, non-countable turn-time interval [start, end). */
  interval: RawInterval;
  /** The instant turn time ends — the earliest countable time can begin. */
  endsAt: Date;
};

/**
 * Resolves the configured turn time, or null when none is configured.
 *
 * @param turnTimeHours elapsed hours, or null / 0 for no turn time
 * @param turnTimeTrigger the event semantic turn time runs from, or null
 */
export function resolveTurnTime(
  events: EngineEvent[],
  turnTimeHours: number | null,
  turnTimeTrigger: string | null
): TurnTime | null {
  if (turnTimeHours === null || turnTimeHours === 0) {
    return null;
  }
  if (turnTimeHours < 0) {
    throw new CalculationRefused(
      "TURN_TIME_NEGATIVE",
      "Cannot calculate: the configured turn-time duration is negative."
    );
  }

  const trigger = (turnTimeTrigger ?? "").trim();
  if (trigger === "") {
    throw new CalculationRefused(
      "TURN_TIME_TRIGGER_UNDEFINED",
      "Cannot calculate: a turn-time duration is set but no trigger event is configured."
    );
  }
  if (!isEngineEventSemantic(trigger)) {
    throw new CalculationRefused(
      "TURN_TIME_TRIGGER_UNRECOGNISED",
      `Cannot calculate: the turn-time trigger "${trigger}" is not a recognised operational-event semantic.`
    );
  }

  const start = resolveRequiredEvent(events, trigger, "TURN_TIME");
  const end = new Date(start.getTime() + turnTimeHours * 3600 * 1000);
  return { interval: { start, end }, endsAt: end };
}
