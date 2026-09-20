/**
 * CALENDAR CLASSIFICATION — structural day-facts for each interval (Phase 6).
 *
 * After partitioning cuts the window into intervals that each fall within one
 * local day, this stage attaches the CALENDAR FACTS of that day, read in the
 * port call's local zone (F18):
 *
 *   - the local calendar date the interval belongs to
 *   - the local weekday (0=Sun … 6=Sat)
 *   - whether that weekday is in the rule set's excluded-weekday set
 *   - whether that local date is a holiday in the reference calendar
 *
 * These are FACTS, not decisions. This stage does NOT decide whether an
 * excluded or holiday interval actually counts — that depends on withheld
 * semantics (SHEX weekday convention B5, holiday precedence B4, EIU) applied
 * in a later engine stage. It also applies no working-day window (a separate
 * stage) and no fraction.
 *
 * Holidays are supplied as a set of local YYYY-MM-DD dates. The pure engine
 * takes no database: the caller loads the applicable reference calendar and
 * injects the dates. This is what lets the product apply a holiday even when
 * the SOF omits it, and reproduce the calendar used by a historical run.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import { getLocalParts } from "./timezone";
import type { RawInterval } from "./partition";

/** The calendar facts of one interval's local day. */
export type CalendarClassification = {
  /** Local calendar date of the interval, YYYY-MM-DD in the port zone. */
  localDate: string;
  /** Local weekday: 0=Sunday … 6=Saturday. */
  weekday: number;
  /** The weekday is in the rule set's excludedWeekdays. */
  isExcludedWeekday: boolean;
  /** The local date is a holiday in the reference calendar. */
  isHoliday: boolean;
};

/** Inputs the classifier needs from the rule set and reference calendar. */
export type CalendarInputs = {
  /** Excluded weekdays as data (0=Sun … 6=Sat). Never a hardcoded weekend. */
  excludedWeekdays: number[];
  /** Holiday local dates, each YYYY-MM-DD, from the reference calendar. */
  holidayDates: ReadonlySet<string>;
};

/** Formats local Y-M-D as a zero-padded YYYY-MM-DD string. */
export function toLocalDateKey(year: number, month: number, day: number): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p2(month)}-${p2(day)}`;
}

/**
 * Classifies one interval's calendar day-facts.
 *
 * The interval is half-open [start, end); its owning local day is taken from
 * `start` (end may be the next local midnight, which belongs to the next
 * day and is not included).
 */
export function classifyIntervalCalendar(
  interval: RawInterval,
  timeZone: string,
  inputs: CalendarInputs
): CalendarClassification {
  const p = getLocalParts(interval.start, timeZone);
  const localDate = toLocalDateKey(p.year, p.month, p.day);

  return {
    localDate,
    weekday: p.weekday,
    isExcludedWeekday: inputs.excludedWeekdays.includes(p.weekday),
    isHoliday: inputs.holidayDates.has(localDate),
  };
}

/** Classifies each interval in order. Thin map over the single-interval form. */
export function classifyIntervalsCalendar(
  intervals: RawInterval[],
  timeZone: string,
  inputs: CalendarInputs
): CalendarClassification[] {
  return intervals.map((iv) => classifyIntervalCalendar(iv, timeZone, inputs));
}
