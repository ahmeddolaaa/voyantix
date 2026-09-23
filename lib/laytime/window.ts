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
  applyCommencementTimeRule,
  resolveRequiredEvent,
  type EngineEvent,
  type CommencementTimeRule,
  type CommencementCalendar,
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
/**
 * Where counting begins, from the term's commencement/turn-time config. Shared
 * by the final window and the provisional running view so both agree on the
 * start; only the END differs between them.
 */
export function deriveCommencementStart(
  events: EngineEvent[],
  commencementRule: string,
  turnTime: TurnTime | null,
  timeZone?: string,
  commencementTimeRule: CommencementTimeRule = "AT_EVENT",
  /** The rule set's calendar; needed when a time rule resolves a "next working day". */
  calendar?: CommencementCalendar
): Date {
  if (commencementTimeRule !== "AT_EVENT") {
    // A time-of-day commencement rule replaces both the raw event instant and
    // any turn time — it is itself the grace mechanism that decides when
    // counting begins from the basis event.
    if (timeZone === undefined) {
      throw new CalculationRefused(
        "COMMENCEMENT_RULE_NEEDS_ZONE",
        "Cannot calculate: a time-of-day commencement rule requires the port call timezone."
      );
    }
    const basis = determineCommencement(events, commencementRule);
    return applyCommencementTimeRule(basis, commencementTimeRule, timeZone, calendar);
  }
  if (turnTime !== null) {
    // Counting begins at the end of turn time (trigger + duration).
    return turnTime.endsAt;
  }
  // No turn time: counting begins at the commencement basis event.
  return determineCommencement(events, commencementRule);
}

export function resolveCandidateWindow(
  events: EngineEvent[],
  commencementRule: string,
  turnTimeHours: number | null,
  turnTimeTrigger: string | null,
  timeZone?: string,
  commencementTimeRule: CommencementTimeRule = "AT_EVENT",
  /** Provisional running view: count up to this instant instead of the
      OPS_COMPLETED event (used before operations complete). */
  windowEndOverride?: Date,
  /** The rule set's calendar; needed when a time rule resolves a "next working day". */
  calendar?: CommencementCalendar
): CandidateWindow {
  const turnTime = resolveTurnTime(events, turnTimeHours, turnTimeTrigger);

  const start = deriveCommencementStart(
    events,
    commencementRule,
    turnTime,
    timeZone,
    commencementTimeRule,
    calendar
  );

  // Counting stops at operations complete — or at the provisional as-of instant.
  const end =
    windowEndOverride !== undefined
      ? windowEndOverride
      : resolveRequiredEvent(events, "OPS_COMPLETED", "WINDOW_END");

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
  /** Time-of-day commencement rule; defaults to AT_EVENT (prior behaviour). */
  commencementTimeRule?: CommencementTimeRule;
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
    input.turnTimeTrigger,
    input.timeZone,
    input.commencementTimeRule ?? "AT_EVENT",
    undefined,
    { excludedWeekdays: input.excludedWeekdays, holidayDates: input.holidayDates }
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
