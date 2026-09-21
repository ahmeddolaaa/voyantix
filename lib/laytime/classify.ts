/**
 * CLASSIFY — preliminary treatment of each interval (Phase 6, pipeline step 6).
 *
 * Takes the FACTS attached to an interval (calendar exclusion, holiday,
 * weather, stoppage) plus the applicable configuration, and assigns a
 * preliminary effective treatment — COUNTED or EXCLUDED — together with the
 * reasons that applied. It does NOT apply EIU: whether an excluded weekday or
 * holiday becomes countable when worked is decided in the separate EIU stage
 * (step 7). Intervals excluded by the calendar are flagged `eiuRelevant` so
 * that stage knows to revisit them.
 *
 * This stage keeps CLASSIFICATION, EFFECTIVE TREATMENT and PROVENANCE
 * distinct, and refuses rather than inventing a semantic it has not been
 * given:
 *   - a stopped interval whose reason has no ContractStoppageRule → refuse
 *     (Q10); the "CountsAgainstOwner" mode's balance effect is not defined by
 *     the baseline and is isolated as a refusal until evidence establishes it
 *   - weather that applies has no frozen counting treatment (Q9: neither 0 nor
 *     pro-rata is a product rule) → refuse, isolated so only a port call that
 *     actually has weather under weatherApplies is affected
 *
 * The working-day window fact (isWithinWorkingDay) is deliberately NOT
 * consumed here: whether time outside the working day counts is an undefined
 * semantic, so asserting it would be an invention. It stays available for a
 * future validated semantic.
 *
 * Treatment is binary per interval, so an interval excluded for two reasons
 * (weekday AND holiday) is simply excluded once — its elapsed time is never
 * double-excluded (Q6).
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import { CalculationRefused } from "./refuse";

/** The three ContractStoppageRule countability modes (Phase 3). */
export type StoppageCountability =
  | "AlwaysExcluded"
  | "NeverExcluded"
  | "CountsAgainstOwner";

/** Facts attached to one interval by the calendar/working-day/event stages. */
export type TaggedFacts = {
  start: Date;
  end: Date;
  isExcludedWeekday: boolean;
  isHoliday: boolean;
  hasWeather: boolean;
  /** Reason id of a stoppage covering the interval, or null. */
  stoppageReasonId: string | null;
};

export type ClassifyConfig = {
  /** Whether the weather axis applies (RuleSetVersion.weatherApplies). */
  weatherApplies: boolean;
  /** reasonId -> countability, from the contract's ContractStoppageRule rows. */
  stoppageRules: ReadonlyMap<string, StoppageCountability>;
};

export type IntervalTreatment = "COUNTED" | "EXCLUDED";

export type ClassifiedInterval = {
  start: Date;
  end: Date;
  treatment: IntervalTreatment;
  /**
   * Authoritative contribution of this interval to counted time: a FRACTION in
   * [0,1] of its elapsed duration (E4). Today only 0 (excluded) or 1 (counted)
   * are produced — the engine is behaviourally binary — but the representation
   * carries a fraction so partial-counting periods (e.g. half-rate weather or
   * shifting time) can be expressed without reworking the output contract when
   * a real charterparty defines them. `treatment` is the coarse view of this
   * value (COUNTED when > 0). Accumulation uses `countedFraction`, not
   * `treatment`.
   */
  countedFraction: number;
  /** Excluded by weekday/holiday; the EIU stage may revisit it. */
  eiuRelevant: boolean;
  /** Applied reason codes (provenance). Persistence shape is Phase 7's concern. */
  reasons: string[];
};

/** Classifies one interval's preliminary treatment. */
export function classifyInterval(
  f: TaggedFacts,
  cfg: ClassifyConfig
): ClassifiedInterval {
  const base = { start: f.start, end: f.end };

  // 1. Stoppage — countability comes only from ContractStoppageRule (F11).
  if (f.stoppageReasonId !== null) {
    const mode = cfg.stoppageRules.get(f.stoppageReasonId);
    if (mode === undefined) {
      throw new CalculationRefused(
        "STOPPAGE_RULE_MISSING",
        `Cannot calculate: the stoppage reason ${f.stoppageReasonId} has no contractual countability rule.`
      );
    }
    if (mode === "AlwaysExcluded") {
      return { ...base, treatment: "EXCLUDED", countedFraction: 0, eiuRelevant: false, reasons: ["STOPPAGE_EXCLUDED"] };
    }
    if (mode === "CountsAgainstOwner") {
      // The balance effect of this mode is not defined by the baseline.
      throw new CalculationRefused(
        "STOPPAGE_OWNER_TREATMENT_UNDEFINED",
        "Cannot calculate: the balance treatment of a 'counts against owner' stoppage is not defined."
      );
    }
    // NeverExcluded — the stoppage imposes no exclusion; fall through to the
    // interval's other facts.
  }

  // 2. Weather — applies but has no frozen counting treatment (Q9).
  if (f.hasWeather && cfg.weatherApplies) {
    throw new CalculationRefused(
      "WEATHER_COUNTING_UNDEFINED",
      "Cannot calculate: weather applies to this interval but its counting treatment is not defined."
    );
  }

  // 3. Calendar exclusion — weekday and/or holiday. EIU decides the final.
  if (f.isExcludedWeekday || f.isHoliday) {
    const reasons: string[] = [];
    if (f.isExcludedWeekday) reasons.push("EXCLUDED_WEEKDAY");
    if (f.isHoliday) reasons.push("HOLIDAY");
    return { ...base, treatment: "EXCLUDED", countedFraction: 0, eiuRelevant: true, reasons };
  }

  // 4. Nothing excludes it.
  return { ...base, treatment: "COUNTED", countedFraction: 1, eiuRelevant: false, reasons: [] };
}

/** Classifies each interval in order. */
export function classifyIntervals(
  facts: TaggedFacts[],
  cfg: ClassifyConfig
): ClassifiedInterval[] {
  return facts.map((f) => classifyInterval(f, cfg));
}
