/**
 * SETTLEMENT — turning a laytime BALANCE into a money AMOUNT (Phase 7).
 *
 * The engine stops at the balance (F16); this separate layer applies the
 * commercial rates. It is the NON-POOLED settlement, which is fully defined
 * by the frozen decisions:
 *
 *   - EXCEEDED  → demurrage owed by the charterer. The rate is a per-running-
 *     day rate (consistent with the running-day allowance unit), pro-rated by
 *     the exceeded time: days = excessSeconds / 86400 rounded to 5 decimals,
 *     amount = days × demurrageRate rounded to cents (see rounding below).
 *   - EXACT     → no amount either way.
 *   - SAVED     → despatch MAY be owed to the charterer. Despatch is optional
 *     (PO3): with no despatchRate nothing is owed. With a rate, the basis
 *     decides the saved-time measure: WTS (working time saved) = the laytime
 *     balance itself (evidence: test_2 sheet). ATS is refused (not evidenced);
 *     a missing basis is refused.
 *
 * Pooled settlement rate selection (B7) is a different, withheld concern and
 * is not handled here.
 *
 * Currency is carried by the rate; none is invented. Pure: no DB, no mutation.
 */

import { CalculationRefused } from "./refuse";
import type { BalanceOutcome } from "./accumulate";

const SECONDS_PER_DAY = 86400;

/**
 * Rounding convention — an ORGANIZATION setting (product owner, 2026-09-24),
 * because the reference tools disagree:
 *   DECIMALS_5 (default) — days rounded to 5 decimals, then × rate. Matches
 *     the MV YUFIX reference calculation: "4.78434 days @ 6,000 / day = 28,706.04".
 *   EXACT — the exact days × rate. Matches the manual test_2 sheet:
 *     3.4769735 d × 4,375 = 15,211.76.
 * Either way the amount is rounded to cents.
 */
export const SETTLEMENT_DAY_PRECISIONS = [
  { value: "DECIMALS_5", label: "5 decimals" },
  { value: "EXACT", label: "Exact (no rounding of days)" },
] as const;

export type SettlementDayPrecision = (typeof SETTLEMENT_DAY_PRECISIONS)[number]["value"];

export function isSettlementDayPrecision(v: unknown): v is SettlementDayPrecision {
  return SETTLEMENT_DAY_PRECISIONS.some((p) => p.value === v);
}

const SETTLEMENT_DAY_DECIMALS = 5;

/** Half-up rounding to `decimals` places, robust to binary float noise. */
export function roundHalfUp(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Math.sign(value) * Number.EPSILON) * f) / f;
}

function settlementDays(seconds: number, precision: SettlementDayPrecision): number {
  const days = seconds / SECONDS_PER_DAY;
  return precision === "EXACT" ? days : roundHalfUp(days, SETTLEMENT_DAY_DECIMALS);
}

export type SettlementInput = {
  outcome: BalanceOutcome;
  /** allowedSeconds − usedSeconds; positive = saved, negative = exceeded. */
  balanceSeconds: number;
  /** Per-running-day demurrage rate (money units). */
  demurrageRate: number;
  /** Per-running-day despatch rate, or null when despatch is not configured. */
  despatchRate: number | null;
  /** "WTS" is settled; "ATS" and anything else are refused. */
  despatchBasis: string | null;
  /** The organization's rounding convention; defaults to DECIMALS_5. */
  dayPrecision?: SettlementDayPrecision;
};

export type Settlement =
  | {
      kind: "demurrage";
      exceededSeconds: number;
      days: number;
      rate: number;
      amount: number;
    }
  | {
      kind: "despatch";
      savedSeconds: number;
      days: number;
      rate: number;
      amount: number;
    }
  | { kind: "none"; reason: "EXACT_BALANCE" | "NO_DESPATCH_CONFIGURED" };

export function settleBalance(input: SettlementInput): Settlement {
  if (input.outcome === "EXCEEDED") {
    const exceededSeconds = -input.balanceSeconds; // balance is negative here
    const days = settlementDays(exceededSeconds, input.dayPrecision ?? "DECIMALS_5");
    return {
      kind: "demurrage",
      exceededSeconds,
      days,
      rate: input.demurrageRate,
      amount: roundHalfUp(days * input.demurrageRate, 2),
    };
  }

  if (input.outcome === "EXACT") {
    return { kind: "none", reason: "EXACT_BALANCE" };
  }

  // SAVED — despatch may be owed.
  if (input.despatchRate === null) {
    return { kind: "none", reason: "NO_DESPATCH_CONFIGURED" };
  }

  // WTS — working time saved: the saved time IS the laytime balance
  // (allowed − used, both already in laytime terms). Evidence: test_2 sheet,
  // 4.3103068 − 0.8333333 = 3.4769735 days saved × $4,375.
  if (input.despatchBasis === "WTS") {
    const savedSeconds = input.balanceSeconds; // balance is positive here
    const days = settlementDays(savedSeconds, input.dayPrecision ?? "DECIMALS_5");
    return {
      kind: "despatch",
      savedSeconds,
      days,
      rate: input.despatchRate,
      amount: roundHalfUp(days * input.despatchRate, 2),
    };
  }

  // ATS (all time saved) needs laytime projected past completion through the
  // excepted periods — not evidenced yet. Any other/missing basis: withheld.
  if (input.despatchBasis === "ATS") {
    throw new CalculationRefused(
      "DESPATCH_ATS_UNDEFINED",
      "Cannot settle despatch: the all-time-saved (ATS) basis is not defined yet. " +
        "Only working time saved (WTS) is calculated."
    );
  }
  throw new CalculationRefused(
    "DESPATCH_BASIS_WITHHELD",
    "Cannot settle despatch: a despatch rate is configured but the despatch " +
      "basis (which saved time despatch is paid on) is not set. Choose a " +
      "despatch basis on the term."
  );
}
