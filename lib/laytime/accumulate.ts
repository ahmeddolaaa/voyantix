/**
 * ACCUMULATE + BALANCE — laytime used vs allowed (Phase 6, pipeline steps 8 & 10).
 *
 * Sums the counted time of a port call's intervals and compares it to the
 * allowed laytime, producing a BALANCE. Per F16 the engine STOPS HERE — it
 * produces a balance, never an amount; converting the balance to money
 * (demurrage/despatch) is the separate settlement layer (Phase 7).
 *
 * The engine works in canonical SECONDS. The allowed laytime is supplied
 * already in seconds: the contract's allowance value and its unit
 * (allowanceUnit — free-text, per-contract) are converted to seconds by the
 * caller, so the withheld unit vocabulary is isolated outside the engine
 * (Q13/Q14 — the engine consumes a resolved allowance and does not assume
 * days or a quantity ÷ rate derivation).
 *
 * Sign convention: balanceSeconds = allowedSeconds − usedSeconds.
 *   > 0  time SAVED (despatch side)
 *   < 0  time EXCEEDED (demurrage side)
 *   = 0  EXACT
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

export type CountedLike = {
  start: Date;
  end: Date;
  treatment: "COUNTED" | "EXCLUDED";
};

/** Total counted time, in seconds, over a port call's intervals. */
export function accumulateCountedSeconds(intervals: CountedLike[]): number {
  let total = 0;
  for (const iv of intervals) {
    if (iv.treatment === "COUNTED") {
      total += (iv.end.getTime() - iv.start.getTime()) / 1000;
    }
  }
  return total;
}

export type BalanceOutcome = "SAVED" | "EXCEEDED" | "EXACT";

export type Balance = {
  allowedSeconds: number;
  usedSeconds: number;
  /** allowedSeconds − usedSeconds. Positive = saved, negative = exceeded. */
  balanceSeconds: number;
  outcome: BalanceOutcome;
};

/** Computes the balance from an allowed and a used figure, both in seconds. */
export function computeBalance(
  allowedSeconds: number,
  usedSeconds: number
): Balance {
  const balanceSeconds = allowedSeconds - usedSeconds;
  const outcome: BalanceOutcome =
    balanceSeconds > 0 ? "SAVED" : balanceSeconds < 0 ? "EXCEEDED" : "EXACT";
  return { allowedSeconds, usedSeconds, balanceSeconds, outcome };
}

/** Convenience: accumulate a port call's intervals and balance them. */
export function balancePortCall(
  intervals: CountedLike[],
  allowedSeconds: number
): Balance {
  return computeBalance(allowedSeconds, accumulateCountedSeconds(intervals));
}
