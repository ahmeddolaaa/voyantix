"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import {
  recalculatePortCall,
  getPortCallCalculation,
  settlePortCall,
  type PersistedCalculation,
  type SettlementView,
} from "@/lib/actions/laytime-calculations";
import { setPortCallLaytimeEnd } from "@/lib/actions/voyage-port-calls";
import { LAYTIME_END_EVENTS, labelOf } from "@/lib/laytime/term-vocabulary";
import { SecondaryButton, StatusBadge } from "@/components/ui";
import { FormError } from "@/components/forms";
import { formatInstant, formatDurationSeconds, formatAmount, sheetBalanceSeconds } from "@/lib/format";

/**
 * Laytime calculation for one port call.
 *
 * A calculation is RUN on demand (Recalculate) and PERSISTED as the port
 * call's single current result; this panel reads it back and shows the
 * balance, the settlement amount and the interval time-sheet. A refusal is a
 * first-class outcome — when the engine cannot compute (a missing event, an
 * unruled stoppage, an undefined semantic) it says so plainly rather than
 * inventing a number.
 *
 * Times are shown in the port call's own effective timezone (F18), the same
 * clock the engine classified against.
 */

const REASON_LABEL: Record<string, string> = {
  STOPPAGE_EXCLUDED: "Stoppage",
  EXCLUDED_WEEKDAY: "Excluded weekday",
  HOLIDAY: "Holiday",
  EIU_KEPT_EXCLUDED: "Excepted (kept excluded)",
  COUNTED_WHILE_EXCLUDED_USED: "Worked on excepted day (counted)",
  EXCLUDED_NOT_USED: "Excepted (not worked)",
  ON_DEMURRAGE: "On demurrage",
};

/** Why a day would normally not count (the cause, not the intermediate steps). */
const CAUSE_REASONS = ["STOPPAGE_EXCLUDED", "EXCLUDED_WEEKDAY", "HOLIDAY"];

function reasonText(reasons: string[], treatment?: string): string {
  if (reasons.length === 0) return "Counted";
  // Once on demurrage, an otherwise-excepted period counts: say that plainly
  // instead of listing "kept excluded" next to a Counted badge.
  if (reasons.includes("ON_DEMURRAGE") && treatment === "COUNTED") {
    const causes = reasons.filter((r) => CAUSE_REASONS.includes(r));
    if (causes.length === 0) return "On demurrage";
    return `${causes.map((r) => REASON_LABEL[r] ?? r).join(" · ")} — counts (on demurrage)`;
  }
  if (reasons.includes("EXCEPTED_ON_DEMURRAGE")) {
    const causes = reasons.filter((r) => CAUSE_REASONS.includes(r));
    return `${causes.map((r) => REASON_LABEL[r] ?? r).join(" · ") || "Excepted"} — still excepted on demurrage`;
  }
  return reasons.map((r) => REASON_LABEL[r] ?? r).join(" · ");
}

function outcomeTone(outcome: string | null): "teal" | "coral" | "neutral" {
  if (outcome === "SAVED") return "teal";
  if (outcome === "EXCEEDED") return "coral";
  return "neutral";
}

function settlementLine(
  s: SettlementView,
  /** Sheet-style balance (allowed − used) for the duration shown beside the amount. */
  shownBalance: number
): { tone: "teal" | "coral" | "neutral"; text: string } {
  switch (s.status) {
    case "settled": {
      const st = s.settlement;
      if (st.kind === "demurrage")
        return { tone: "coral", text: `Demurrage ${formatAmount(st.amount)} (${formatDurationSeconds(-shownBalance)} over)` };
      if (st.kind === "despatch")
        return { tone: "teal", text: `Despatch ${formatAmount(st.amount)} (${formatDurationSeconds(shownBalance)} saved)` };
      return {
        tone: "neutral",
        text: st.reason === "NO_DESPATCH_CONFIGURED" ? "Nothing owed (no despatch configured)" : "Nothing owed",
      };
    }
    case "settlement_refused":
      return {
        tone: "neutral",
        text: s.code === "DESPATCH_ATS_UNDEFINED"
          ? "Despatch owed, but the ATS basis is not calculated yet"
          : "Despatch owed, but no despatch basis is set on the term",
      };
    case "calculation_refused":
      return { tone: "neutral", text: "Not settleable — the calculation was refused" };
    case "no_calculation":
      return { tone: "neutral", text: "Not calculated yet" };
  }
}

export function PortCallCalculation({
  portCallId,
  timeZone,
  termLaytimeEnd = null,
  laytimeEndOverride = null,
  onLaytimeEndChanged,
  onRecalculated,
}: {
  portCallId: string;
  timeZone: string;
  /** The resolved term's default laytime-end event (null = no term). */
  termLaytimeEnd?: string | null;
  /** This port call's override (null = follow the term). */
  laytimeEndOverride?: string | null;
  onLaytimeEndChanged?: (value: string | null) => void;
  /** Called after every successful recalculation (the statement may be stale). */
  onRecalculated?: () => void;
}) {
  const [calc, setCalc] = useState<PersistedCalculation | null>(null);
  const [settlement, setSettlement] = useState<SettlementView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const r = await getPortCallCalculation(portCallId);
    if (!r.ok) {
      setError(r.message);
      setLoaded(true);
      return;
    }
    setCalc(r.data);
    if (r.data && r.data.status === "calculated") {
      const s = await settlePortCall(portCallId);
      setSettlement(s.ok ? s.data : null);
    } else {
      setSettlement(null);
    }
    setLoaded(true);
  }, [portCallId]);

  useEffect(() => {
    void load();
  }, [load]);

  function recalculate() {
    setError(null);
    startTransition(async () => {
      const r = await recalculatePortCall(portCallId);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      await load();
      onRecalculated?.();
    });
  }

  /** Change where laytime ends for THIS vessel, then recalculate in one step. */
  function changeLaytimeEnd(value: string) {
    const next = value === "" ? null : value;
    setError(null);
    startTransition(async () => {
      const saved = await setPortCallLaytimeEnd(portCallId, next);
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      onLaytimeEndChanged?.(saved.data.laytimeEndOverride);
      const r = await recalculatePortCall(portCallId);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      await load();
      onRecalculated?.();
    });
  }

  const border = { borderTop: "1px solid var(--line)" } as const;
  const muted = { color: "var(--steel)" } as const;
  const termEndLabel = labelOf(LAYTIME_END_EVENTS, termLaytimeEnd ?? "OPS_COMPLETED") ?? "Operations completed";

  return (
    <div className="mt-4 pt-4" style={border}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12.5px]" style={{ fontWeight: 500, color: "var(--ink-soft)" }}>
          Laytime calculation
        </span>
        <SecondaryButton
          onClick={recalculate}
          disabled={pending}
          className="!px-2.5 !py-1 !text-[12px]"
        >
          {pending ? "Calculating…" : "Recalculate"}
        </SecondaryButton>
      </div>

      {termLaytimeEnd !== null && (
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          <label htmlFor={`laytime-end-${portCallId}`} className="text-[12px]" style={muted}>
            Laytime ends at
          </label>
          <select
            id={`laytime-end-${portCallId}`}
            value={laytimeEndOverride ?? ""}
            disabled={pending}
            onChange={(e) => changeLaytimeEnd(e.target.value)}
            className="px-2 py-1 rounded text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
            style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            <option value="">{termEndLabel} (term default)</option>
            {LAYTIME_END_EVENTS.filter((o) => o.value !== (termLaytimeEnd ?? "OPS_COMPLETED") || o.value === laytimeEndOverride).map((o) => (
              <option key={o.value} value={o.value}>{o.label} — this vessel only</option>
            ))}
          </select>
        </div>
      )}

      {error && <FormError message={error} />}

      {!loaded && (
        <p className="text-[12.5px]" style={muted}>
          Loading…
        </p>
      )}

      {loaded && !calc && (
        <p className="text-[12.5px]" style={muted}>
          Not calculated yet. Run a calculation once the port call has its
          events, stoppages and a resolved term.
        </p>
      )}

      {loaded && calc && calc.status === "refused" && (
        <div className="text-[13px]">
          <StatusBadge tone="rust">Refused</StatusBadge>
          <span className="ml-2" style={{ color: "var(--ink)" }}>
            {calc.refusalReason ?? "The calculation was refused."}
          </span>
          <div className="text-[11.5px] mt-1" style={muted}>
            {calc.refusalCode} · engine {calc.engineVersion} ·{" "}
            {formatInstant(new Date(calc.calculatedAt), timeZone)}
          </div>
        </div>
      )}

      {loaded && calc && calc.status === "calculated" && (
        <div className="text-[13px]">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span>
              <span style={muted}>Allowed </span>
              <span className="num">{formatDurationSeconds(calc.allowedSeconds ?? 0)}</span>
            </span>
            <span>
              <span style={muted}>Used </span>
              <span className="num">{formatDurationSeconds(calc.usedSeconds ?? 0)}</span>
            </span>
            <span>
              <span style={muted}>Balance </span>
              <span className="num">{formatDurationSeconds(sheetBalanceSeconds(calc.allowedSeconds ?? 0, calc.usedSeconds ?? 0))}</span>
            </span>
            <StatusBadge tone={outcomeTone(calc.outcome)}>
              {calc.outcome === "SAVED"
                ? "Time saved"
                : calc.outcome === "EXCEEDED"
                  ? "Time exceeded"
                  : "On the mark"}
            </StatusBadge>
          </div>

          {calc.window && (
            <div className="text-[12px] mt-1.5" style={muted}>
              Laytime window {formatInstant(new Date(calc.window.start), timeZone)} →{" "}
              {formatInstant(new Date(calc.window.end), timeZone)}
            </div>
          )}

          {settlement && (
            <div className="mt-2">
              {(() => {
                const s = settlementLine(settlement, sheetBalanceSeconds(calc.allowedSeconds ?? 0, calc.usedSeconds ?? 0));
                return <StatusBadge tone={s.tone}>{s.text}</StatusBadge>;
              })()}
            </div>
          )}

          {calc.intervals.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowSheet((v) => !v)}
                className="text-[12px] underline"
                style={{ color: "var(--teal)" }}
              >
                {showSheet ? "Hide" : "Show"} time-sheet ({calc.intervals.length} intervals)
              </button>

              {showSheet && (
                <div className="mt-2 rounded-md overflow-hidden" style={{ border: "1px solid var(--line)" }}>
                  {calc.intervals.map((iv, i) => (
                    <div
                      key={iv.sequence}
                      className="px-3 py-1.5 text-[12px]"
                      style={{
                        borderTop: i === 0 ? undefined : "1px solid var(--line)",
                        background: iv.treatment === "COUNTED" ? "var(--card)" : "var(--bg)",
                      }}
                    >
                      {/* Line 1: the period and its status; line 2: why (if anything special). */}
                      <div className="flex items-center justify-between gap-3">
                        <span className="num whitespace-nowrap" style={muted}>
                          {formatInstant(new Date(iv.start), timeZone)} → {formatInstant(new Date(iv.end), timeZone)}
                        </span>
                        {iv.countedFraction >= 1 ? (
                          <StatusBadge tone="teal">Counted</StatusBadge>
                        ) : iv.countedFraction <= 0 ? (
                          <StatusBadge tone="neutral">Excluded</StatusBadge>
                        ) : (
                          <StatusBadge tone="brass">
                            Counted {Math.round(iv.countedFraction * 100)}%
                          </StatusBadge>
                        )}
                      </div>
                      {iv.reasons.length > 0 && (
                        <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-soft)" }}>
                          {reasonText(iv.reasons, iv.treatment)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-[11.5px] mt-1.5" style={muted}>
            engine {calc.engineVersion} · {formatInstant(new Date(calc.calculatedAt), timeZone)}
          </div>
        </div>
      )}
    </div>
  );
}
