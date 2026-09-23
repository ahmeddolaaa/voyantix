/**
 * PIPELINE — wiring the mechanical stages into a port-call balance (Phase 6).
 *
 * Given a CANDIDATE WINDOW (the countable [start, end) span) and the resolved
 * configuration, this runs the deterministic pipeline:
 *
 *   partition at local-day boundaries
 *     → tag each slice with stoppage/weather facts (cut at event boundaries)
 *     → attach the day's calendar facts (weekday/holiday)
 *     → classify each piece (preliminary treatment)
 *     → apply EIU
 *     → accumulate counted time and balance it against the allowance
 *
 * It stops at the BALANCE (F16). Deriving the candidate window itself —
 * composing commencement (step 2), turn time (step 3) and the window-ending
 * event (step 4) — is intentionally NOT done here: those boundaries carry
 * commercial semantics not settled by the decision baseline, so the window is
 * an explicit input and the derivation is isolated to the caller.
 *
 * The working-day-window split is likewise not applied here, because whether
 * time outside working hours counts is an undefined semantic; working-day.ts
 * remains a ready primitive for when that semantic is defined.
 *
 * Open stoppages must be closed to concrete spans by the caller before being
 * passed in (consistent with how an open weather period extends to the window
 * end). `didWorkOccur` supplies the isolated "used" determination the EIU
 * stage needs when eiuApplies is false.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import { partitionAtDayBoundaries } from "./partition";
import { tagIntervalWithEvents, type StoppageSpan } from "./event-tagging";
import { deriveWeatherPeriods, type WeatherEvent } from "./event-periods";
import { classifyIntervalCalendar } from "./calendar-classification";
import {
  classifyInterval,
  type StoppageCountability,
  type TaggedFacts,
  type ClassifiedInterval,
} from "./classify";
import { applyEiu } from "./eiu";
import { balancePortCall, type Balance } from "./accumulate";
import { applyOnceOnDemurrage } from "./demurrage-state";

export type PortCallCalcInput = {
  /** The countable window. How it is derived is the caller's isolated concern. */
  window: { start: Date; end: Date };
  timeZone: string;

  // --- reusable rule-set semantics ---
  excludedWeekdays: number[];
  holidayDates: ReadonlySet<string>;
  weatherApplies: boolean;
  eiuApplies: boolean;

  // --- contract configuration ---
  stoppageRules: ReadonlyMap<string, StoppageCountability>;
  /** Allowed laytime in seconds (unit already resolved by the caller). */
  allowedSeconds: number;
  /** "Once on demurrage, always on demurrage" (AN-2). Default false. */
  onceOnDemurrage?: boolean;
  /** Stoppage reason ids that still interrupt time once on demurrage. */
  demurrageExceptedReasonIds?: ReadonlySet<string>;

  // --- operational data (live, concrete spans) ---
  stoppages: StoppageSpan[];
  weatherEvents: WeatherEvent[];

  // --- isolated evidence-dependent semantic ---
  didWorkOccur: (interval: ClassifiedInterval) => boolean;
};

export type PortCallCalcResult = {
  balance: Balance;
  /** The final classified time-sheet (the single source of calculation truth). */
  intervals: ClassifiedInterval[];
  /** When OODAOD applies: the instant laytime expired, else null. */
  demurrageExpiresAt: Date | null;
};

export function calculatePortCall(
  input: PortCallCalcInput
): PortCallCalcResult {
  // Weather periods are paired once, extending any open period to window end.
  const weatherPeriods = deriveWeatherPeriods(input.weatherEvents, input.window.end);

  // Partition the window into local days; each day carries its own calendar facts.
  const days = partitionAtDayBoundaries(input.window, input.timeZone);

  const facts: TaggedFacts[] = [];
  for (const day of days) {
    const cal = classifyIntervalCalendar(day, input.timeZone, {
      excludedWeekdays: input.excludedWeekdays,
      holidayDates: input.holidayDates,
    });
    // Cut the day at stoppage/weather boundaries and inherit the day's calendar facts.
    const pieces = tagIntervalWithEvents(day, input.stoppages, weatherPeriods);
    for (const p of pieces) {
      facts.push({
        start: p.start,
        end: p.end,
        isExcludedWeekday: cal.isExcludedWeekday,
        isHoliday: cal.isHoliday,
        hasWeather: p.hasWeather,
        stoppageReasonId: p.stoppageReasonId,
      });
    }
  }

  const classified = facts.map((f) =>
    classifyInterval(f, {
      weatherApplies: input.weatherApplies,
      stoppageRules: input.stoppageRules,
    })
  );

  const afterEiu = applyEiu(classified, input.eiuApplies, input.didWorkOccur);
  const oodaod = applyOnceOnDemurrage(
    afterEiu,
    input.allowedSeconds,
    input.onceOnDemurrage ?? false,
    input.demurrageExceptedReasonIds
  );
  const balance = balancePortCall(oodaod.intervals, input.allowedSeconds);

  return {
    balance,
    intervals: oodaod.intervals,
    demurrageExpiresAt: oodaod.expiresAt,
  };
}
