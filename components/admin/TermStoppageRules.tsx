"use client";

import { useEffect, useState, useTransition } from "react";
import {
  listStoppageRules,
  setStoppageRule,
  deleteStoppageRule,
  type ContractStoppageRuleRow,
} from "@/lib/actions/contract-stoppage-rules";
import type { StoppageCountability } from "@/lib/laytime/classify";
import { FormError } from "@/components/forms";
import { Card, SecondaryButton, StatusBadge } from "@/components/ui";

/**
 * STOPPAGE RULES for one contract term — how each stoppage reason in the SOF
 * affects laytime under this charterparty, and (when the term is "once on
 * demurrage, always on demurrage") which reasons are EXCEPTIONS that still
 * stop the clock after laytime expires, e.g. breakdown of the vessel.
 *
 * A reason without a rule is not guessed: a calculation that meets it is
 * refused, so the table states that plainly. Each change saves immediately.
 */

type ReasonOption = { id: string; name: string; status: "active" | "inactive" };

const selectStyle = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
} as const;

export function TermStoppageRules({
  termId,
  termLabel,
  onceOnDemurrage,
  reasons,
  onClose,
}: {
  termId: string;
  termLabel: string;
  onceOnDemurrage: boolean;
  reasons: ReasonOption[];
  onClose: () => void;
}) {
  const [rules, setRules] = useState<Record<string, ContractStoppageRuleRow>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingReason, setSavingReason] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void listStoppageRules(termId).then((r) => {
      if (!alive) return;
      if (r.ok) setRules(Object.fromEntries(r.data.map((x) => [x.stoppageReasonId, x])));
      else setError(r.message);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [termId]);

  function save(reasonId: string, countability: string, excludedOnDemurrage: boolean) {
    setError(null);
    setSavingReason(reasonId);
    const existing = rules[reasonId];
    const c = countability as StoppageCountability;
    const flag = c === "AlwaysExcluded" && excludedOnDemurrage;
    const optimistic: ContractStoppageRuleRow = {
      id: existing?.id ?? "",
      termId,
      stoppageReasonId: reasonId,
      countability: c,
      excludedOnDemurrage: flag,
    };
    // Show the choice at once (outside the transition, which would defer it
    // until the save completes); roll back if the save is rejected.
    if (countability !== "") {
      setRules((prev) => ({ ...prev, [reasonId]: optimistic }));
    }
    startTransition(async () => {
      if (countability === "") {
        if (existing) {
          const r = await deleteStoppageRule(existing.id);
          if (!r.ok) {
            setError(r.message);
          } else {
            setRules((prev) => {
              const next = { ...prev };
              delete next[reasonId];
              return next;
            });
          }
        }
        setSavingReason(null);
        return;
      }
      const r = await setStoppageRule(termId, {
        stoppageReasonId: reasonId,
        countability: c,
        excludedOnDemurrage: flag,
      });
      if (!r.ok) {
        setError(r.message);
        setRules((prev) => {
          const next = { ...prev };
          if (existing) next[reasonId] = existing;
          else delete next[reasonId];
          return next;
        });
      } else {
        setRules((prev) => ({ ...prev, [reasonId]: { ...optimistic, id: r.data.id } }));
      }
      setSavingReason(null);
    });
  }

  // Active reasons, plus any inactive reason that already has a rule.
  const visible = reasons.filter((r) => r.status === "active" || rules[r.id]);
  const unset = visible.filter((r) => !rules[r.id]).length;
  const muted = { color: "var(--steel)" } as const;

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-display text-[15px] font-medium" style={{ color: "var(--ink)" }}>
            Stoppage rules
          </div>
          <div className="text-[12.5px] mt-0.5" style={muted}>
            {termLabel}
          </div>
        </div>
        <SecondaryButton onClick={onClose} className="!px-2.5 !py-1 !text-[12px]">
          Close
        </SecondaryButton>
      </div>

      <p className="text-[12.5px] mt-2 mb-3" style={{ color: "var(--ink-soft)" }}>
        How each stoppage recorded in the SOF affects laytime under this term.
        {onceOnDemurrage
          ? " This term is once on demurrage, always on demurrage: after laytime expires every stoppage counts, except the ones marked as still excluded on demurrage."
          : ""}
      </p>

      <FormError message={error} />

      {!loaded && (
        <p className="text-[12.5px]" style={muted}>
          Loading…
        </p>
      )}

      {loaded && visible.length === 0 && (
        <p className="text-[12.5px]" style={muted}>
          No stoppage reasons exist yet. Add them under Administration → Stoppage reasons.
        </p>
      )}

      {loaded && visible.length > 0 && (
        <>
          {unset > 0 && (
            <div className="mb-3">
              <StatusBadge tone="rust">
                {unset} reason{unset === 1 ? "" : "s"} without a rule — a calculation that meets one is refused
              </StatusBadge>
            </div>
          )}
          <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--line)" }}>
            <div
              className="grid grid-cols-[1fr_220px_190px] gap-3 px-3 py-2 text-[11.5px] font-medium"
              style={{ background: "var(--bg-subtle)", color: "var(--steel)" }}
            >
              <span>Stoppage reason</span>
              <span>Effect on laytime</span>
              <span>Still excluded on demurrage</span>
            </div>
            {visible.map((reason, i) => {
              const rule = rules[reason.id];
              const value: string = rule?.countability ?? "";
              const busy = savingReason === reason.id;
              const canExcept = onceOnDemurrage && value === "AlwaysExcluded";
              return (
                <div
                  key={reason.id}
                  className="grid grid-cols-[1fr_220px_190px] gap-3 px-3 py-2 items-center text-[13px]"
                  style={{ borderTop: i === 0 ? undefined : "1px solid var(--line)" }}
                >
                  <span style={{ color: "var(--ink)" }}>
                    {reason.name}
                    {reason.status === "inactive" && (
                      <span className="text-[11.5px]" style={muted}> · inactive</span>
                    )}
                  </span>
                  <select
                    aria-label={`Effect of ${reason.name} on laytime`}
                    value={value}
                    disabled={busy}
                    onChange={(e) =>
                      save(reason.id, e.target.value, rule?.excludedOnDemurrage ?? false)
                    }
                    className="w-full px-2 py-1.5 rounded text-[12.5px]"
                    style={{
                      ...selectStyle,
                      ...(value === "" ? { borderColor: "var(--rust)" } : {}),
                    }}
                  >
                    <option value="">Not set</option>
                    <option value="AlwaysExcluded">Excluded from laytime</option>
                    <option value="NeverExcluded">Counts as laytime</option>
                    {value === "CountsAgainstOwner" && (
                      <option value="CountsAgainstOwner">Counts against owner (not supported)</option>
                    )}
                  </select>
                  <label
                    className="inline-flex items-center gap-2 text-[12.5px]"
                    style={{ color: canExcept ? "var(--ink)" : "var(--steel)", opacity: canExcept ? 1 : 0.6 }}
                    title={
                      !onceOnDemurrage
                        ? "Only used when the term is once on demurrage, always on demurrage"
                        : value !== "AlwaysExcluded"
                          ? "Only an excluded stoppage can stay excluded on demurrage"
                          : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={rule?.excludedOnDemurrage ?? false}
                      disabled={!canExcept || busy}
                      onChange={(e) => save(reason.id, value, e.target.checked)}
                    />
                    {rule?.excludedOnDemurrage ? "Yes, stops the clock" : "No"}
                  </label>
                </div>
              );
            })}
          </div>
          {!onceOnDemurrage && (
            <p className="text-[11.5px] mt-2" style={muted}>
              The last column applies only when this term is set to once on demurrage, always on demurrage.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
