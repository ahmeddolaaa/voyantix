/**
 * PARTITION — cutting a time window at local-day boundaries (Phase 6).
 *
 * The laytime engine judges time day-by-day in the port call's local zone
 * (F18). Before any classification, the candidate window is cut into
 * intervals that each fall within a single local day, so that later stages
 * (weekday, holiday, working-day, weather, stoppage classification) can
 * reason one local day at a time.
 *
 * This module does ONLY the mechanical cut at local midnight. It applies no
 * business rule, reads no configuration, and makes no countability decision.
 * All boundaries are local-midnight instants from lib/laytime/timezone.ts,
 * which is DST-safe.
 *
 * Interval semantics are half-open [start, end), matching stoppages
 * elsewhere in the product: two adjacent intervals touch at a boundary
 * without overlapping. The emitted intervals are contiguous and gap-free and
 * exactly cover the input window.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import { nextLocalMidnight } from "./timezone";

/** A raw, unclassified slice of time. Classification is a later stage. */
export type RawInterval = {
  start: Date;
  end: Date;
};

/**
 * Cuts [window.start, window.end) at every local midnight in `timeZone`.
 *
 * - An empty window (start equal to end) yields no intervals.
 * - A reversed window (start after end) is a data error and throws.
 * - A window within a single local day yields exactly one interval.
 * - Otherwise, each interval runs from one boundary to the next, the first
 *   starting at window.start and the last ending at window.end.
 */
export function partitionAtDayBoundaries(
  window: { start: Date; end: Date },
  timeZone: string
): RawInterval[] {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();

  if (startMs > endMs) {
    throw new Error(
      "partitionAtDayBoundaries: window start is after window end."
    );
  }
  if (startMs === endMs) {
    return [];
  }

  const intervals: RawInterval[] = [];
  let cursor = window.start;

  // Walk forward one local day at a time. Each step ends at the next local
  // midnight, unless the window ends first. nextLocalMidnight is strictly
  // after cursor, so the cursor always advances and the loop terminates.
  while (cursor.getTime() < endMs) {
    const boundary = nextLocalMidnight(cursor, timeZone);
    const sliceEnd =
      boundary.getTime() < endMs ? boundary : window.end;
    intervals.push({ start: cursor, end: sliceEnd });
    cursor = sliceEnd;
  }

  return intervals;
}
