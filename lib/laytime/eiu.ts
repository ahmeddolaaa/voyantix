/**
 * APPLY EIU — even-if-used resolution (Phase 6, pipeline step 7).
 *
 * A deliberately separate stage (never merged into classification). It revisits
 * only the intervals the classify stage flagged `eiuRelevant` — those excluded
 * by an excluded weekday or a holiday:
 *
 *   - eiuApplies = true  → the interval stays excluded EVEN IF worked.
 *   - eiuApplies = false → operational use makes the excluded time countable
 *     (UNLESS used); if it was not worked, it stays excluded.
 *
 * `eiuApplies` is the single RuleSetVersion-level flag (Q4/Q5 baseline — no
 * per-weekday or per-holiday EIU policy, no generic usage-policy abstraction).
 *
 * WHAT COUNTS AS "USED" is an isolated, evidence-dependent semantic: this
 * stage does not define it. The caller supplies `didWorkOccur`, and its
 * definition (or its own refusal when undefined) lives outside this stage.
 * The resolver is consulted ONLY when eiuApplies is false and the interval is
 * eiuRelevant — so a fully-defined EIU-applies calculation never triggers a
 * "used" determination that might itself be undefined.
 *
 * The original classification and reasons survive: a flip appends a reason so
 * "excluded weekday, worked, therefore counted" stays auditable, distinct from
 * "excluded weekday, not worked, stayed excluded".
 *
 * Pure: no DB, no mutation of inputs, no ambient timezone.
 */

import type { ClassifiedInterval } from "./classify";

export function applyEiu(
  intervals: ClassifiedInterval[],
  eiuApplies: boolean,
  didWorkOccur: (interval: ClassifiedInterval) => boolean
): ClassifiedInterval[] {
  return intervals.map((iv) => {
    if (!iv.eiuRelevant) {
      return iv;
    }

    // Excluded by the calendar. EIU governs the outcome.
    if (eiuApplies) {
      // Stays excluded even if used; the resolver is not consulted.
      return { ...iv, reasons: [...iv.reasons, "EIU_KEPT_EXCLUDED"] };
    }

    // Unless used: operational work flips it to countable.
    const used = didWorkOccur(iv);
    if (used) {
      return {
        ...iv,
        treatment: "COUNTED",
        countedFraction: 1,
        reasons: [...iv.reasons, "COUNTED_WHILE_EXCLUDED_USED"],
      };
    }
    return { ...iv, reasons: [...iv.reasons, "EXCLUDED_NOT_USED"] };
  });
}
