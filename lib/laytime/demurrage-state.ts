/**
 * ONCE ON DEMURRAGE, ALWAYS ON DEMURRAGE (AN-2) — a cumulative re-treatment
 * stage that runs after EIU and before accumulation.
 *
 * Classification is per-interval and order-independent; OODAOD is not: an
 * interval's treatment depends on whether the allowance is already exhausted
 * at that point. This stage walks the classified time-sheet in order, finds
 * the exact instant the allowance is used up (the EXPIRY), splits the interval
 * that contains it, and from the expiry onward treats every interval as fully
 * counted — the laytime exceptions (excluded weekdays, holidays, stoppages)
 * no longer interrupt time once the vessel is on demurrage.
 *
 * Evidence (reference documents): MY FELLAS loading (3000 MT PWWD FSHEX EIU),
 * MY FELLAS discharge (SSHEX EIU) and MV YUFIX (Fri 17:00–Mon 08:00 NTC even if
 * used, "Once on demurrage always on demurrage") all count every period after
 * expiry at 100% — including the Friday/weekend exception and every SOF
 * stoppage (labour breaks, port closure, Friday prayer) that fell after it.
 *
 * EXCEPTIONS: a charterparty may keep specific delays interrupting time even
 * on demurrage (e.g. breakdown of the vessel, shifting). These are configured
 * per stoppage reason; an interval excluded by such a stoppage stays excluded
 * after expiry. Only stoppage reasons can be excepted — the calendar
 * exceptions (excluded days, holidays) always lift, as in every reference.
 *
 * Gated by a per-term flag, default OFF: with the flag off this stage is the
 * identity and behaviour is unchanged.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import { type ClassifiedInterval } from "./classify";

export const ON_DEMURRAGE_REASON = "ON_DEMURRAGE";
export const EXCEPTED_ON_DEMURRAGE_REASON = "EXCEPTED_ON_DEMURRAGE";

function elapsedSeconds(iv: { start: Date; end: Date }): number {
  return (iv.end.getTime() - iv.start.getTime()) / 1000;
}

function asOnDemurrage(iv: ClassifiedInterval, start: Date, end: Date): ClassifiedInterval {
  return {
    start,
    end,
    treatment: "COUNTED",
    countedFraction: 1,
    eiuRelevant: false,
    // Keep the lifted exception reasons for provenance, then mark the lift.
    reasons: [...iv.reasons, ON_DEMURRAGE_REASON],
  };
}

export type DemurrageStateResult = {
  intervals: ClassifiedInterval[];
  /** The instant the allowance was exhausted, or null if it never was. */
  expiresAt: Date | null;
};

/**
 * Applies OODAOD to an ordered, non-overlapping time-sheet. When `enabled` is
 * false the intervals are returned untouched.
 */
export function applyOnceOnDemurrage(
  intervals: ClassifiedInterval[],
  allowedSeconds: number,
  enabled: boolean,
  /** Stoppage reason ids that still interrupt time once on demurrage. */
  exceptedReasonIds: ReadonlySet<string> = new Set()
): DemurrageStateResult {
  if (!enabled) return { intervals, expiresAt: null };

  const afterExpiry = (iv: ClassifiedInterval, start: Date, end: Date): ClassifiedInterval =>
    iv.treatment === "EXCLUDED" &&
    iv.stoppageReasonId !== undefined &&
    exceptedReasonIds.has(iv.stoppageReasonId)
      ? { ...iv, start, end, reasons: [...iv.reasons, EXCEPTED_ON_DEMURRAGE_REASON] }
      : asOnDemurrage(iv, start, end);

  const out: ClassifiedInterval[] = [];
  let used = 0;
  let expiresAt: Date | null = null;

  for (const iv of intervals) {
    if (expiresAt !== null) {
      out.push(afterExpiry(iv, iv.start, iv.end));
      continue;
    }

    // Allowance already nil before any time counted: on demurrage from the start.
    if (allowedSeconds <= 0) {
      expiresAt = iv.start;
      out.push(afterExpiry(iv, iv.start, iv.end));
      continue;
    }

    const contribution = elapsedSeconds(iv) * iv.countedFraction;
    const remaining = allowedSeconds - used;

    if (contribution < remaining || iv.countedFraction <= 0) {
      used += contribution;
      out.push(iv);
      continue;
    }

    // The allowance runs out inside (or exactly at the end of) this interval.
    const secondsToExpiry = remaining / iv.countedFraction;
    const expiryMs = iv.start.getTime() + secondsToExpiry * 1000;
    const expiry = new Date(Math.round(expiryMs));
    used = allowedSeconds;
    expiresAt = expiry;

    if (expiry.getTime() > iv.start.getTime()) {
      out.push({ ...iv, end: expiry });
    }
    if (expiry.getTime() < iv.end.getTime()) {
      out.push(asOnDemurrage(iv, expiry, iv.end));
    }
  }

  return { intervals: out, expiresAt };
}
