/**
 * LOADING / DISCHARGING FINISH FORECAST — "will it finish in laytime?"
 *
 * An ESTIMATE for the operator, never part of a calculation, statement or
 * claim (Adel, 2026-09-24). Pure: the laytime engine is passed in as
 * `usedAt(t)`, the provisional running figure had the clock been read at t,
 * so excepted days, holidays and recorded stoppages are honoured exactly as
 * the running status honours them.
 *
 *   pace        = tonnes handled ÷ time since operations commenced
 *   finish      = now + remaining tonnes ÷ pace
 *   runs out    = first instant the engine's used time reaches the allowance
 *   needed pace = remaining tonnes ÷ time left until laytime runs out
 *   at finish   = allowance − used(finish)  (negative = over laytime)
 *
 * Shift records carry a date, not a time, so the pace is the whole-period
 * average, not the last shift's.
 */

export type ForecastInput = {
  now: Date;
  /** Operations commenced (the event), or null if not recorded yet. */
  commencedAt: Date | null;
  handledMt: number;
  plannedMt: number;
  allowedSeconds: number;
  /** Engine: laytime used (seconds) had the running clock been read at t. */
  usedAt: (t: Date) => number;
};

export type Forecast =
  | {
      kind: "unavailable";
      reason: "NO_PLAN" | "NOT_COMMENCED" | "TOO_EARLY" | "NO_TONNAGE" | "PLAN_REACHED";
      message: string;
    }
  | {
      kind: "forecast";
      paceMtPerDay: number;
      remainingMt: number;
      finishAt: Date;
      /** When laytime runs out; null if already on demurrage (see onDemurrageNow) or beyond the search horizon. */
      laytimeRunsOutAt: Date | null;
      onDemurrageNow: boolean;
      /** Allowance − used at the forecast finish. Negative = finishes over laytime. */
      balanceAtFinishSeconds: number;
      /** Tonnes/day needed to finish before laytime runs out; null when it already ran out. */
      neededPaceMtPerDay: number | null;
    };

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 60;

export function forecastFinish(i: ForecastInput): Forecast {
  if (i.plannedMt <= 0) {
    return { kind: "unavailable", reason: "NO_PLAN", message: "Add the cargo plan to forecast the finish." };
  }
  if (i.handledMt >= i.plannedMt) {
    return { kind: "unavailable", reason: "PLAN_REACHED", message: "The planned quantity is reached." };
  }
  if (!i.commencedAt) {
    return {
      kind: "unavailable",
      reason: "NOT_COMMENCED",
      message: "Record “operations commenced” to forecast the finish.",
    };
  }
  const elapsedMs = i.now.getTime() - i.commencedAt.getTime();
  if (elapsedMs < 3600_000) {
    return { kind: "unavailable", reason: "TOO_EARLY", message: "Too early to read a pace — check back after the first hour." };
  }
  if (i.handledMt <= 0) {
    return { kind: "unavailable", reason: "NO_TONNAGE", message: "Log the first shift to forecast the finish." };
  }

  const pace = i.handledMt / (elapsedMs / DAY_MS);
  const remaining = i.plannedMt - i.handledMt;
  const finishAt = new Date(i.now.getTime() + (remaining / pace) * DAY_MS);

  const usedNow = i.usedAt(i.now);
  const onDemurrageNow = usedNow >= i.allowedSeconds;

  let runsOut: Date | null = null;
  if (!onDemurrageNow) {
    let lo = i.now.getTime();
    let hi = lo + HORIZON_DAYS * DAY_MS;
    if (i.usedAt(new Date(hi)) >= i.allowedSeconds) {
      // used(t) never decreases: bisect to the minute.
      while (hi - lo > 60_000) {
        const mid = Math.floor((lo + hi) / 2);
        if (i.usedAt(new Date(mid)) >= i.allowedSeconds) hi = mid;
        else lo = mid;
      }
      runsOut = new Date(hi);
    }
  }

  const neededPace =
    runsOut === null
      ? onDemurrageNow
        ? null
        : 0
      : remaining / ((runsOut.getTime() - i.now.getTime()) / DAY_MS);

  return {
    kind: "forecast",
    paceMtPerDay: pace,
    remainingMt: remaining,
    finishAt,
    laytimeRunsOutAt: runsOut,
    onDemurrageNow,
    balanceAtFinishSeconds: i.allowedSeconds - i.usedAt(finishAt),
    neededPaceMtPerDay: neededPace,
  };
}
