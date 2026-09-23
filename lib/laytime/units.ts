/**
 * ALLOWANCE UNIT — converting a laytime allowance quantity to canonical
 * seconds (Phase 7 caller concern; the engine works in seconds only).
 *
 * Only pure-duration units are defined: "hours" and "days" (a running day =
 * 24h). The allowance is a BUDGET of countable time; WHICH hours count is
 * decided by the classification pipeline (excluded weekdays, holidays,
 * weather, EIU) on the used side, never baked into the unit. Units that
 * bundle an exclusion semantic into the unit itself — "working days",
 * "weather working days", and the like — would double-count against the
 * rule-set's own exclusions, and reconciling that overlap is a withheld
 * semantic (allowanceUnit vocabulary, B1). Such units are therefore REFUSED,
 * not guessed.
 *
 * Pure: no DB, no mutation, no ambient state.
 */

import { CalculationRefused } from "./refuse";

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

export function allowanceToSeconds(value: string, unit: string): number {
  const n = Number((value ?? "").trim());
  if (!Number.isFinite(n)) {
    throw new CalculationRefused(
      "ALLOWANCE_VALUE_INVALID",
      `Cannot calculate: the allowance "${value}" is not a number.`
    );
  }
  if (n < 0) {
    throw new CalculationRefused(
      "ALLOWANCE_VALUE_NEGATIVE",
      "Cannot calculate: the allowance cannot be negative."
    );
  }

  switch ((unit ?? "").trim().toLowerCase()) {
    case "hour":
    case "hours":
      return n * SECONDS_PER_HOUR;
    case "day":
    case "days":
      return n * SECONDS_PER_DAY;
    default:
      throw new CalculationRefused(
        "ALLOWANCE_UNIT_UNRECOGNISED",
        `Cannot calculate: the allowance unit "${unit}" has no defined conversion. ` +
          `Express the allowance in hours or days, or establish this unit's meaning before calculating.`
      );
  }
}

/**
 * Allowed laytime for a RATE-based term: actual cargo quantity ÷ a MT-per-day
 * rate, in seconds. This is the common real-world basis ("3000 MT PWWD" →
 * quantity / 3000 days). WHICH of those days actually count (weekends,
 * holidays, weather) is the classification pipeline's job, not this number;
 * the rate here is a plain per-running-day rate.
 */
export function allowedSecondsFromRate(
  quantityMt: number,
  ratePerDay: number
): number {
  if (!(quantityMt > 0) || !(ratePerDay > 0)) {
    throw new CalculationRefused(
      "ALLOWANCE_RATE_INVALID",
      "Cannot calculate: a rate-based allowance needs a positive cargo quantity and a positive rate."
    );
  }
  return (quantityMt / ratePerDay) * SECONDS_PER_DAY;
}
