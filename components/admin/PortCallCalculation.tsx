"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import {
  recalculatePortCall,
  getPortCallCalculation,
  settlePortCall,
  type PersistedCalculation,
  type SettlementView,
} from "@/lib/actions/laytime-calculations";
import { SecondaryButton, StatusBadge } from "@/components/ui";
import { FormError } from "@/components/forms";
import { formatInstant, formatDurationSeconds, formatAmount } from "@/lib/format";

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
};

function reasonText(reasons: string[]): string {
  if (reasons.length === 0) return "Counted";
  return reasons.map((r) => REASON_LABEL[r] ?? r).join(" · ");
}

function outcomeTone(outcome: string | null): "teal" | "rust" | "neutral" {
  if (outcome === "SAVED") return "teal";
  if (outcome === "EXCEEDED") return "rust";
  return "neutral";
}

function settlementLine(s: SettlementView): { tone: "teal" | "rust" | "neutral"; text: string } {
  switch (s.status) {
    case "settled": {
      const st = s.settlement;
      if (st.kind === "demurrage")
        return { tone: "rust", text: `Demurrage ${formatAmount(st.amount)} (${formatDurationSeconds(st.exceededSeconds)} over)` };
      if (st.kind === "despatch")
        return { tone: "teal", text: `Despatch ${formatAmount(st.amount)}` };
      return {
        tone: "neutral",
        text: st.reason === "NO_DESPATCH_CONFIGURED" ? "Nothing owed (no despatch configured)" : "Nothing owed",
      };
    }
    case "settlement_refused":
      return { tone: "neutral", text: "Despatch owed, but its basis is not defined" };
    case "calculation_refused":
      return { tone: "neutral", text: "Not settleable — the calculation was refused" };
    case "no_calculation":
      return { tone: "neutral", text: "Not calculated yet" };
  }
}

export function PortCallCalculation({
  portCallId,
  timeZone,
}: {
  portCallId: string;
  timeZone: string;
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
    });
  }

  const border = { borderTop: "1px solid var(--line)" } as const;
  const muted = { color: "var(--steel)" } as const;

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
              <span className="num">{formatDurationSeconds(calc.balanceSeconds ?? 0)}</span>
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
                const s = settlementLine(settlement);
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
                style={{ color: "var(--brass)" }}
              >
                {showSheet ? "Hide" : "Show"} time-sheet ({calc.intervals.length} intervals)
              </button>

              {showSheet && (
                <div className="mt-2 rounded-md overflow-hidden" style={{ border: "1px solid var(--line)" }}>
                  {calc.intervals.map((iv, i) => (
                    <div
                      key={iv.sequence}
                      className="flex items-center justify-between px-3 py-1.5 text-[12px]"
                      style={{
                        borderTop: i === 0 ? undefined : "1px solid var(--line)",
                        background: iv.treatment === "COUNTED" ? "var(--card)" : "var(--bg)",
                      }}
                    >
                      <span className="num" style={muted}>
                        {formatInstant(new Date(iv.start), timeZone)} →{" "}
                        {formatInstant(new Date(iv.end), timeZone)}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span style={{ color: "var(--ink-soft)" }}>{reasonText(iv.reasons)}</span>
                        <StatusBadge tone={iv.treatment === "COUNTED" ? "teal" : "neutral"}>
                          {iv.treatment === "COUNTED" ? "Counted" : "Excluded"}
                        </StatusBadge>
                      </span>
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
