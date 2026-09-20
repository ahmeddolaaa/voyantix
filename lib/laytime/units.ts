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
