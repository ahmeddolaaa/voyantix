/**
 * WORKING-DAY WINDOW — split an interval at working-hour boundaries (Phase 6).
 *
 * A rule set may define a working-day window (workingDayStart / workingDayEnd,
 * stored as local clock times, HH:MM[:SS]). Within each local day, time inside
 * that window is inside the working day; time outside it is not. This stage
 * cuts an interval at those boundaries and tags each resulting piece with the
 * FACT `isWithinWorkingDay`.
 *
 * It is a mechanical cut, not a decision. Whether time OUTSIDE the working day
 * counts is withheld semantics applied later; this stage only records where
 * the boundaries fall and which side each piece is on. The window bounds are
 * DATA supplied per contract (never a hardcoded time), and the engine handles
 * whatever a customer configures:
 *
 *   - no window (start or end null) -> the whole interval is within the
 *     working day (the window is not applied)
 *   - a same-day window (start < end) -> a single [start,end) working span
 *   - a window that crosses local midnight (start > end, e.g. a night shift
 *     22:00-06:00) -> two working spans, one at each end of the day
 *
 * The input interval is assumed to lie within a single local day (as produced
 * by partitionAtDayBoundaries). Pure: no DB, no mutation, no ambient zone.
 */

import { getLocalParts, instantFromLocal } from "./timezone";
import type { RawInterval } from "./partition";

/** A raw interval tagged with whether it is inside the working-day window. */
export type WorkingDayPiece = {
  start: Date;
  end: Date;
  isWithinWorkingDay: boolean;
};

/** Clock-time bounds of the working day, as configured (local HH:MM[:SS]). */
export type WorkingDayWindow = {
  /** e.g. "08:00" or "08:00:00", or null when no window is configured. */
  start: string | null;
  /** e.g. "17:00", or null when no window is configured. */
  end: string | null;
};

/** Parses "HH:MM" or "HH:MM:SS" into components. */
function parseClock(value: string): { hour: number; minute: number; second: number } {
  const [h, m, s] = value.split(":");
  return { hour: Number(h), minute: Number(m), second: s ? Number(s) : 0 };
}

/**
 * The absolute instant of a local clock time on the local day that `dayAnchor`
 * falls in, in `timeZone`.
 */
function localClockOnDayOf(
  dayAnchor: Date,
  clock: string,
  timeZone: string
): Date {
  const p = getLocalParts(dayAnchor, timeZone);
  const c = parseClock(clock);
  return instantFromLocal(
    { year: p.year, month: p.month, day: p.day, hour: c.hour, minute: c.minute, second: c.second },
    timeZone
  );
}

/** Clamps [a,b) intersection helper: returns the overlap of two half-open
 *  intervals, or null if they do not overlap. */
function overlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): { start: number; end: number } | null {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return s < e ? { start: s, end: e } : null;
}

/**
 * Splits `interval` (assumed within one local day) at the working-day window
 * boundaries, returning contiguous pieces tagged isWithinWorkingDay.
 *
 * The pieces are in time order, gap-free, and cover the interval exactly.
 */
export function splitAtWorkingDay(
  interval: RawInterval,
  timeZone: string,
  window: WorkingDayWindow
): WorkingDayPiece[] {
  const ivStart = interval.start.getTime();
  const ivEnd = interval.end.getTime();

  // No window configured: the whole interval is within the working day.
  if (window.start === null || window.end === null) {
    return [{ start: interval.start, end: interval.end, isWithinWorkingDay: true }];
  }

  const startInstant = localClockOnDayOf(interval.start, window.start, timeZone).getTime();
  const endInstant = localClockOnDayOf(interval.start, window.end, timeZone).getTime();

  // Determine the working spans (in ms) for this local day.
  // Same-day window: one span [start,end). Crossing-midnight window
  // (start >= end): two spans — [dayStart..end) and [start..dayEnd) — but
  // since the interval is within one local day, we express the working set as
  // "before end" plus "after start" within the day.
  let workingSpans: Array<{ start: number; end: number }>;
  if (startInstant < endInstant) {
    workingSpans = [{ start: startInstant, end: endInstant }];
  } else {
    // Crosses local midnight: working time is [midnight..end) and [start..nextMidnight).
    // Represent with open-ended bounds clipped to the interval below.
    workingSpans = [
      { start: -Infinity, end: endInstant },
      { start: startInstant, end: Infinity },
    ];
  }

  // Build working sub-intervals clipped to the interval.
  const working: Array<{ start: number; end: number }> = [];
  for (const span of workingSpans) {
    const ov = overlap(ivStart, ivEnd, span.start, span.end);
    if (ov) working.push(ov);
  }
  working.sort((a, b) => a.start - b.start);

  // Walk the interval, emitting working and non-working pieces in order.
  const pieces: WorkingDayPiece[] = [];
  let cursor = ivStart;
  for (const w of working) {
    if (w.start > cursor) {
      pieces.push({ start: new Date(cursor), end: new Date(w.start), isWithinWorkingDay: false });
    }
    pieces.push({ start: new Date(w.start), end: new Date(w.end), isWithinWorkingDay: true });
    cursor = w.end;
  }
  if (cursor < ivEnd) {
    pieces.push({ start: new Date(cursor), end: new Date(ivEnd), isWithinWorkingDay: false });
  }

  return pieces;
}
