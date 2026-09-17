/**
 * EVENT TAGGING — splitting intervals at stoppage/weather boundaries (Phase 6).
 *
 * After the calendar layer produces intervals within a single local day, this
 * stage cuts them further at the boundaries of operational event periods —
 * stoppages (explicit spans) and weather periods (paired from point events by
 * event-periods.ts) — and tags each resulting piece with the FACTS:
 *
 *   - stoppageReasonId: the reason of a stoppage covering the piece, or null
 *   - hasWeather: whether a weather period covers the piece
 *
 * These are facts, not decisions. Whether a stopped piece counts is withheld
 * (it depends on ContractStoppageRule countability, per F11); whether weather
 * suppresses counting is withheld (B3). This stage only records where the
 * event boundaries fall and which piece each fact applies to. Stoppage and
 * weather are independent — a piece may carry both.
 *
 * Overlap note: the product enforces one open stoppage and no overlapping
 * stoppages per port call (Phase 5 EXCLUDE), so at most one stoppage covers a
 * piece; stoppageReasonId is therefore single-valued. Weather is independent.
 *
 * Pure: no DB, no mutation, no ambient timezone. Half-open [start,end).
 */

import type { RawInterval } from "./partition";
import type { WeatherPeriod } from "./event-periods";

/** A stoppage span with its reason, as loaded by the caller. */
export type StoppageSpan = {
  start: Date;
  /** Open stoppages must be closed to a concrete end by the caller (e.g. the
   *  window end) before tagging; this stage takes concrete spans only. */
  end: Date;
  reasonId: string;
};

/** An interval piece tagged with operational-event facts. */
export type EventTaggedPiece = {
  start: Date;
  end: Date;
  /** Reason of a stoppage covering this piece, or null. */
  stoppageReasonId: string | null;
  /** A weather period covers this piece. */
  hasWeather: boolean;
};

/** Collects every distinct boundary instant that falls strictly inside the
 *  interval, from all event spans, so the interval can be cut there. */
function innerBoundaries(
  iv: RawInterval,
  spans: Array<{ start: Date; end: Date }>
): number[] {
  const s = iv.start.getTime();
  const e = iv.end.getTime();
  const set = new Set<number>();
  for (const span of spans) {
    const bs = span.start.getTime();
    const be = span.end.getTime();
    if (bs > s && bs < e) set.add(bs);
    if (be > s && be < e) set.add(be);
  }
  return [...set].sort((a, b) => a - b);
}

/** True if [ps,pe) is covered by span [ss,se) (piece lies within the span). */
function covers(ss: number, se: number, ps: number, pe: number): boolean {
  return ss <= ps && pe <= se;
}

/**
 * Splits `interval` at all stoppage and weather boundaries and tags each
 * resulting piece. Pieces are contiguous, gap-free, and cover the interval
 * exactly. A piece is tagged with a stoppage reason / weather when the
 * corresponding period covers it.
 */
export function tagIntervalWithEvents(
  interval: RawInterval,
  stoppages: StoppageSpan[],
  weatherPeriods: WeatherPeriod[]
): EventTaggedPiece[] {
  const cuts = innerBoundaries(interval, [...stoppages, ...weatherPeriods]);

  // Build the ordered boundary list: start, inner cuts, end.
  const bounds = [interval.start.getTime(), ...cuts, interval.end.getTime()];

  const pieces: EventTaggedPiece[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const ps = bounds[i];
    const pe = bounds[i + 1];
    if (pe <= ps) continue; // guard against duplicate boundaries

    const stoppage = stoppages.find((sp) =>
      covers(sp.start.getTime(), sp.end.getTime(), ps, pe)
    );
    const weather = weatherPeriods.some((wp) =>
      covers(wp.start.getTime(), wp.end.getTime(), ps, pe)
    );

    pieces.push({
      start: new Date(ps),
      end: new Date(pe),
      stoppageReasonId: stoppage ? stoppage.reasonId : null,
      hasWeather: weather,
    });
  }

  return pieces;
}
