/**
 * Voyantix Laytime Engine
 * ------------------------------------------------------------------------
 * Pure, deterministic calculation function. No I/O, no persistence.
 * Given a voyage's timing window, its allowed laytime, its rates, and its
 * stoppages, produces the set of calculated Time Sheet Entry intervals
 * plus the Statement-level aggregate figures.
 *
 * Business rules implemented here are FROZEN — see Section 4 of the
 * rebuild spec. Do not change the sign conventions or rounding behavior
 * without re-validating against the two worked examples in the test file.
 * ------------------------------------------------------------------------
 */

export type EngineStoppageInput = {
  id: string;
  reasonId: string;
  reasonName: string;
  /** ISO timestamp */
  startTime: string;
  /** ISO timestamp, or null if the stoppage is still open */
  endTime: string | null;
};

export type EngineInput = {
  /** ISO timestamp — laytime clock start (NOR Acceptance) */
  laytimeStartTime: string;
  /** ISO timestamp — laytime clock end (Sailing Time, or "now" if not yet sailed) */
  laytimeEndTime: string;
  allowedLaytimeDays: number;
  demurrageRatePerDay: number;
  despatchRatePerDay: number;
  stoppages: EngineStoppageInput[];
};

export type EngineInterval = {
  startTime: string;
  endTime: string;
  durationHours: number;
  currentState: "On Laytime" | "On Demurrage";
  countedOrExcluded: "Counted" | "Excluded";
  relatedStoppageId: string | null;
};

export type EngineResult = {
  intervals: EngineInterval[];
  timeUsedDays: number;
  timeBalanceDays: number;
  settlementType: "Demurrage" | "Despatch";
  settlementAmountUsd: number;
};

const MS_PER_HOUR = 1000 * 60 * 60;
const HOURS_PER_DAY = 24;

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_PER_HOUR;
}

/**
 * Merge overlapping/adjacent stoppages (clipped to the laytime window) into
 * a sorted, non-overlapping list. A stoppage with no End Time is treated as
 * extending to the laytime window's end for calculation purposes, and is
 * flagged via `openEnded` so callers can still show "Open — In Progress"
 * in the UI even though the engine had to close it for the math.
 */
function normalizeStoppages(
  stoppages: EngineStoppageInput[],
  windowStart: Date,
  windowEnd: Date
): Array<{
  start: Date;
  end: Date;
  sourceId: string;
  reasonId: string;
  reasonName: string;
}> {
  const clipped = stoppages
    .map((s) => {
      const rawStart = new Date(s.startTime);
      const rawEnd = s.endTime ? new Date(s.endTime) : windowEnd;

      // Invalid data guard (lesson learned #2): end before start.
      if (rawEnd.getTime() < rawStart.getTime()) {
        return null;
      }

      const start = rawStart < windowStart ? windowStart : rawStart;
      const end = rawEnd > windowEnd ? windowEnd : rawEnd;
      if (end.getTime() <= start.getTime()) return null;

      return {
        start,
        end,
        sourceId: s.id,
        reasonId: s.reasonId,
        reasonName: s.reasonName,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Merge overlaps — when merged, keep the first stoppage's identity for
  // Related Stoppage purposes (a documented simplification; true many-to-many
  // attribution across a merged interval is a v1.1 refinement).
  const merged: typeof clipped = [];
  for (const s of clipped) {
    const last = merged[merged.length - 1];
    if (last && s.start.getTime() <= last.end.getTime()) {
      if (s.end.getTime() > last.end.getTime()) last.end = s.end;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

export function invalidStoppages(
  stoppages: EngineStoppageInput[]
): EngineStoppageInput[] {
  return stoppages.filter((s) => {
    if (!s.endTime) return false;
    return new Date(s.endTime).getTime() < new Date(s.startTime).getTime();
  });
}

export function runLaytimeEngine(input: EngineInput): EngineResult {
  const windowStart = new Date(input.laytimeStartTime);
  const windowEnd = new Date(input.laytimeEndTime);

  if (windowEnd.getTime() <= windowStart.getTime()) {
    throw new Error(
      "Invalid engine input: laytimeEndTime must be after laytimeStartTime"
    );
  }

  const stoppages = normalizeStoppages(input.stoppages, windowStart, windowEnd);

  // Build the raw counted/excluded segment list by walking the window and
  // cutting out each normalized stoppage.
  type RawSegment = {
    start: Date;
    end: Date;
    countedOrExcluded: "Counted" | "Excluded";
    relatedStoppageId: string | null;
  };

  const rawSegments: RawSegment[] = [];
  let cursor = windowStart;

  for (const s of stoppages) {
    if (s.start.getTime() > cursor.getTime()) {
      rawSegments.push({
        start: cursor,
        end: s.start,
        countedOrExcluded: "Counted",
        relatedStoppageId: null,
      });
    }
    rawSegments.push({
      start: s.start,
      end: s.end,
      countedOrExcluded: "Excluded",
      relatedStoppageId: s.sourceId,
    });
    cursor = s.end;
  }
  if (cursor.getTime() < windowEnd.getTime()) {
    rawSegments.push({
      start: cursor,
      end: windowEnd,
      countedOrExcluded: "Counted",
      relatedStoppageId: null,
    });
  }

  // Walk the counted segments in order, tracking cumulative counted hours,
  // to determine the On Laytime → On Demurrage transition point, and split
  // a segment at that point if it straddles the threshold. Excluded
  // segments inherit the regime of the cumulative counted clock at the
  // point they occur (display-only classification; they never count
  // toward Time Used regardless of state).
  const allowedHours = input.allowedLaytimeDays * HOURS_PER_DAY;
  let cumulativeCountedHours = 0;
  const intervals: EngineInterval[] = [];

  for (const seg of rawSegments) {
    const segHours = hoursBetween(seg.start, seg.end);

    if (seg.countedOrExcluded === "Excluded") {
      const state: EngineInterval["currentState"] =
        cumulativeCountedHours >= allowedHours ? "On Demurrage" : "On Laytime";
      intervals.push({
        startTime: seg.start.toISOString(),
        endTime: seg.end.toISOString(),
        durationHours: round2(segHours),
        currentState: state,
        countedOrExcluded: "Excluded",
        relatedStoppageId: seg.relatedStoppageId,
      });
      continue;
    }

    // Counted segment — check whether the allowed-laytime threshold falls
    // inside it.
    const startCumulative = cumulativeCountedHours;
    const endCumulative = cumulativeCountedHours + segHours;

    if (startCumulative >= allowedHours) {
      // Entire segment is already in demurrage.
      intervals.push({
        startTime: seg.start.toISOString(),
        endTime: seg.end.toISOString(),
        durationHours: round2(segHours),
        currentState: "On Demurrage",
        countedOrExcluded: "Counted",
        relatedStoppageId: null,
      });
    } else if (endCumulative <= allowedHours) {
      // Entire segment still within allowed laytime.
      intervals.push({
        startTime: seg.start.toISOString(),
        endTime: seg.end.toISOString(),
        durationHours: round2(segHours),
        currentState: "On Laytime",
        countedOrExcluded: "Counted",
        relatedStoppageId: null,
      });
    } else {
      // Threshold falls inside this segment — split it.
      const hoursUntilThreshold = allowedHours - startCumulative;
      const splitPoint = new Date(
        seg.start.getTime() + hoursUntilThreshold * MS_PER_HOUR
      );
      intervals.push({
        startTime: seg.start.toISOString(),
        endTime: splitPoint.toISOString(),
        durationHours: round2(hoursUntilThreshold),
        currentState: "On Laytime",
        countedOrExcluded: "Counted",
        relatedStoppageId: null,
      });
      intervals.push({
        startTime: splitPoint.toISOString(),
        endTime: seg.end.toISOString(),
        durationHours: round2(segHours - hoursUntilThreshold),
        currentState: "On Demurrage",
        countedOrExcluded: "Counted",
        relatedStoppageId: null,
      });
    }

    cumulativeCountedHours = endCumulative;
  }

  const timeUsedDays = cumulativeCountedHours / HOURS_PER_DAY;
  const timeBalanceDays = input.allowedLaytimeDays - timeUsedDays;

  const settlementType: "Demurrage" | "Despatch" =
    timeBalanceDays < 0 ? "Demurrage" : "Despatch";
  const rate =
    settlementType === "Demurrage"
      ? input.demurrageRatePerDay
      : input.despatchRatePerDay;
  const settlementAmountUsd = Math.abs(timeBalanceDays) * rate;

  return {
    intervals,
    timeUsedDays: round4(timeUsedDays),
    timeBalanceDays: round4(timeBalanceDays),
    settlementType,
    settlementAmountUsd: round2(settlementAmountUsd),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
