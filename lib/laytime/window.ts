/**
 * CANDIDATE WINDOW — deriving the countable span, then calculating (Phase 6,
 * pipeline steps 1–4 + the top-level entry point).
 *
 * Product-owner decisions (2026-09-20):
 *   - Window START: when turn time is configured, counting begins at
 *     turnTimeTrigger + turnTimeHours; when no turn time is configured, it
 *     begins at the commencementRule event. (commencementRule is used only in
 *     the no-turn-time path.)
 *   - Window END: counting stops at the OPS_COMPLETED event.
 *
 * The turn-time interval itself sits BEFORE the countable window (the grace
 * period), so it is returned for provenance but is not part of the counted
 * span. Every required event that is missing, or a window that ends at/before
 * it starts, is a refusal — never a guess.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import {
  determineCommencement,
  resolveRequiredEvent,
  type EngineEvent,
} from "./commencement";
import { resolveTurnTime, type TurnTime } from "./turn-time";
import { CalculationRefused } from "./refuse";
import {
  calculatePortCall,
  type PortCallCalcInput,
  type PortCallCalcResult,
} from "./pipeline";

export type CandidateWindow = {
  window: { start: Date; end: Date };
  /** The visible non-countable turn-time interval, or null. */
  turnTime: TurnTime | null;
  /** The instant laytime commences (start of counting), for provenance. */
  commencementAt: Date;
};

/**
 * Derives the countable window from the term's commencement/turn-time config
 * and the port call's live events.
 */
export function resolveCandidateWindow(
  events: EngineEvent[],
  commencementRule: string,
  turnTimeHours: number | null,
  turnTimeTrigger: string | null
): CandidateWindow {
  const turnTime = resolveTurnTime(events, turnTimeHours, turnTimeTrigger);

  let start: Date;
  if (turnTime !== null) {
    // Counting begins at the end of turn time (trigger + duration).
    start = turnTime.endsAt;
  } else {
    // No turn time: counting begins at the commencement basis event.
    start = determineCommencement(events, commencementRule);
  }

  // Counting stops at operations complete.
  const end = resolveRequiredEvent(events, "OPS_COMPLETED", "WINDOW_END");

  if (start.getTime() >= end.getTime()) {
    throw new CalculationRefused(
      "WINDOW_EMPTY",
      "Cannot calculate: the countable window ends at or before it begins (operations completed before laytime could start)."
    );
  }

  return { window: { start, end }, turnTime, commencementAt: start };
}

export type CalcFromEventsInput = Omit<PortCallCalcInput, "window"> & {
  events: EngineEvent[];
  commencementRule: string;
  turnTimeHours: number | null;
  turnTimeTrigger: string | null;
};

export type CalcFromEventsResult = PortCallCalcResult & {
  window: { start: Date; end: Date };
  turnTime: TurnTime | null;
  commencementAt: Date;
};

/**
 * Top-level entry: derive the candidate window from events + config, then run
 * the pipeline. The single call an action layer makes to calculate a port call.
 */
export function calculateFromEvents(
  input: CalcFromEventsInput
): CalcFromEventsResult {
  const cw = resolveCandidateWindow(
    input.events,
    input.commencementRule,
    input.turnTimeHours,
    input.turnTimeTrigger
  );

  const result = calculatePortCall({
    window: cw.window,
    timeZone: input.timeZone,
    excludedWeekdays: input.excludedWeekdays,
    holidayDates: input.holidayDates,
    weatherApplies: input.weatherApplies,
    eiuApplies: input.eiuApplies,
    stoppageRules: input.stoppageRules,
    allowedSeconds: input.allowedSeconds,
    stoppages: input.stoppages,
    weatherEvents: input.weatherEvents,
    didWorkOccur: input.didWorkOccur,
  });

  return {
    ...result,
    window: cw.window,
    turnTime: cw.turnTime,
    commencementAt: cw.commencementAt,
  };
}
