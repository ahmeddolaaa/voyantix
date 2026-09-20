/**
 * SETTLEMENT — turning a laytime BALANCE into a money AMOUNT (Phase 7).
 *
 * The engine stops at the balance (F16); this separate layer applies the
 * commercial rates. It is the NON-POOLED settlement, which is fully defined
 * by the frozen decisions:
 *
 *   - EXCEEDED  → demurrage owed by the charterer. The rate is a per-running-
 *     day rate (consistent with the running-day allowance unit), pro-rated by
 *     the exceeded time: amount = (excessSeconds / 86400) × demurrageRate.
 *   - EXACT     → no amount either way.
 *   - SAVED     → despatch MAY be owed to the charterer. Despatch is optional
 *     (PO3): with no despatchRate it is simply not configured, and nothing is
 *     owed. When a despatchRate IS configured, the saved-time MEASURE depends
 *     on despatchBasis, whose vocabulary is WITHHELD (B-level). This layer
 *     therefore REFUSES to compute a configured despatch rather than assuming
 *     "all time saved" or any other basis — exactly as the engine refuses an
 *     undefined semantic upstream.
 *
 * Pooled settlement rate selection (B7) is a different, withheld concern and
 * is not handled here.
 *
 * Currency is carried by the rate; none is invented. Pure: no DB, no mutation.
 */

import { CalculationRefused } from "./refuse";
import type { BalanceOutcome } from "./accumulate";

const SECONDS_PER_DAY = 86400;

export type SettlementInput = {
  outcome: BalanceOutcome;
  /** allowedSeconds − usedSeconds; positive = saved, negative = exceeded. */
  balanceSeconds: number;
  /** Per-running-day demurrage rate (money units). */
  demurrageRate: number;
  /** Per-running-day despatch rate, or null when despatch is not configured. */
  despatchRate: number | null;
  /** The despatch basis; its vocabulary is withheld, so any configured value
   *  is refused rather than interpreted. */
  despatchBasis: string | null;
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
    const days = exceededSeconds / SECONDS_PER_DAY;
    return {
      kind: "demurrage",
      exceededSeconds,
      days,
      rate: input.demurrageRate,
      amount: days * input.demurrageRate,
    };
  }

  if (input.outcome === "EXACT") {
    return { kind: "none", reason: "EXACT_BALANCE" };
  }

  // SAVED — despatch may be owed.
  if (input.despatchRate === null) {
    return { kind: "none", reason: "NO_DESPATCH_CONFIGURED" };
  }

  // A despatch rate is configured, but the saved-time basis is withheld.
  throw new CalculationRefused(
    "DESPATCH_BASIS_WITHHELD",
    "Cannot settle despatch: a despatch rate is configured but the despatch " +
      "basis (which saved time despatch is paid on) is not defined. Establish " +
      "the despatch basis before settling."
  );
}
