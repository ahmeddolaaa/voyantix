"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  getProvisionalStatus,
  type ProvisionalOutcome,
} from "@/lib/actions/provisional-status";
import { formatInstant, formatDurationSeconds } from "@/lib/format";

/**
 * PROVISIONAL RUNNING STATUS — a live, reference-only laytime meter for a port
 * call still in progress. It shows how much laytime is used against allowed
 * and how long until demurrage, so users can watch daily progress and see the
 * penalty coming before it lands.
 *
 * It is NOT the settlement. Until an actual cargo quantity is recorded the
 * allowance is derived from PLANNED quantity, so the panel labels itself
 * PROVISIONAL and defers to the settled calculation once actuals exist.
 *
 * "Dynamic" here is honest: the authoritative figures come from the server
 * (which counts to now, applying the same holiday/stoppage/EIU exclusions), and
 * the panel re-fetches on an interval. The only thing ticking every second is
 * the port-local clock — never the used/remaining figures, because whether the
 * current moment counts is the engine's decision, not the browser's.
 */

const REFRESH_MS = 30_000;

type Zone = "comfortable" | "approaching" | "demurrage";

function zoneOf(usedSeconds: number, allowedSeconds: number): Zone {
  if (allowedSeconds <= 0) return usedSeconds > 0 ? "demurrage" : "approaching";
  const pct = usedSeconds / allowedSeconds;
  if (pct >= 1) return "demurrage";
  if (pct >= 0.75) return "approaching";
  return "comfortable";
}

const ZONE_COLOR: Record<Zone, string> = {
  comfortable: "var(--teal)",
  approaching: "var(--rust)",
  demurrage: "var(--danger)",
};
const ZONE_SOFT: Record<Zone, string> = {
  comfortable: "var(--teal-soft)",
  approaching: "var(--rust-soft)",
  demurrage: "var(--danger-soft)",
};

export function PortCallProvisionalStatus({
  portCallId,
  timeZone,
}: {
  portCallId: string;
  timeZone: string;
}) {
  const [outcome, setOutcome] = useState<ProvisionalOutcome | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const mounted = useRef(true);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true);
      const r = await getProvisionalStatus(portCallId);
      if (!mounted.current) return;
      if (r.ok) setOutcome(r.data);
      setLoaded(true);
      setRefreshing(false);
    },
    [portCallId]
  );

  useEffect(() => {
    mounted.current = true;
    void load(false);
    const refresh = setInterval(() => void load(true), REFRESH_MS);
    // Port-local wall clock, the one honestly-live element.
    setNow(new Date());
    const clock = setInterval(() => setNow(new Date()), 1_000);
    return () => {
      mounted.current = false;
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load]);

  const border = { borderTop: "1px solid var(--line)" } as const;
  const muted = { color: "var(--steel)" } as const;

  // Only meaningful for an operation in progress; the caller gates on ACTIVE.
  if (loaded && (!outcome || outcome.status === "refused")) {
    // A refusal here is expected before a term/quantity exists — stay quiet
    // rather than shouting an error on an in-progress call. Show one soft line.
    const reason =
      outcome && outcome.status === "refused" ? outcome.reason : null;
    return (
      <div className="mt-4 pt-4" style={border}>
        <div
          className="text-[12.5px] mb-1"
          style={{ fontWeight: 500, color: "var(--ink-soft)" }}
        >
          Live laytime status
        </div>
        <p className="text-[12.5px]" style={muted}>
          {reason ??
            "A running status will appear once this call has a resolved term and a planned quantity."}
        </p>
      </div>
    );
  }

  if (!loaded || !outcome || outcome.status !== "provisional") {
    return (
      <div className="mt-4 pt-4" style={border}>
        <div
          className="text-[12.5px] mb-1"
          style={{ fontWeight: 500, color: "var(--ink-soft)" }}
        >
          Live laytime status
        </div>
        <p className="text-[12.5px]" style={muted}>
          Loading…
        </p>
      </div>
    );
  }

  const s = outcome;
  const zone = zoneOf(s.usedSeconds, s.allowedSeconds);
  const color = ZONE_COLOR[zone];
  const soft = ZONE_SOFT[zone];
  const pct =
    s.allowedSeconds > 0
      ? Math.max(0, Math.min(100, (s.usedSeconds / s.allowedSeconds) * 100))
      : s.usedSeconds > 0
        ? 100
        : 0;
  const overPct =
    s.allowedSeconds > 0 && s.usedSeconds > s.allowedSeconds
      ? Math.min(
          100,
          ((s.usedSeconds - s.allowedSeconds) / s.allowedSeconds) * 100
        )
      : 0;

  const heroLabel = s.onDemurrage ? "On demurrage" : "Time to demurrage";
  const heroValue = formatDurationSeconds(Math.abs(s.remainingSeconds));
  const heroSuffix = s.onDemurrage ? "over" : "left";

  const warnLine = s.onDemurrage
    ? "Laytime is used up — every counted hour now accrues demurrage."
    : zone === "approaching"
      ? "Approaching the limit — demurrage is close."
      : null;

  return (
    <div className="mt-4 pt-4" style={border}>
      <div className="flex items-center justify-between mb-3">
        <span className="inline-flex items-center gap-2">
          <span className="relative inline-flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-70"
              style={{ background: color, animation: "pcps-ping 1.6s cubic-bezier(0,0,.2,1) infinite" }}
            />
            <span
              className="relative inline-flex rounded-full h-2 w-2"
              style={{ background: color }}
            />
          </span>
          <span
            className="text-[12.5px]"
            style={{ fontWeight: 500, color: "var(--ink-soft)" }}
          >
            Live laytime status
          </span>
        </span>
        <span
          className="text-[10.5px] px-2 py-0.5 rounded uppercase tracking-wide"
          style={{
            background: s.quantityIsActual ? "var(--brass-soft)" : "var(--line-soft)",
            color: s.quantityIsActual ? "var(--brass)" : "var(--steel)",
            fontWeight: 600,
          }}
        >
          {s.quantityIsActual ? "Actual qty" : "Provisional"}
        </span>
      </div>

      {/* Hero: the demurrage countdown, the striking centrepiece. */}
      <div
        className="rounded-lg px-4 py-3.5"
        style={{ background: soft, border: `1px solid ${color}` }}
      >
        <div
          className="text-[10.5px] uppercase tracking-wider mb-1"
          style={{ color, fontWeight: 600, opacity: 0.85 }}
        >
          {heroLabel}
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className="num font-display leading-none"
            style={{ color, fontSize: 30, fontWeight: 600 }}
          >
            {heroValue}
          </span>
          <span className="text-[12px]" style={{ color, opacity: 0.75 }}>
            {heroSuffix}
          </span>
        </div>
        {warnLine && (
          <div className="text-[11.5px] mt-1.5" style={{ color }}>
            {warnLine}
          </div>
        )}
      </div>

      {/* Progress meter: used against allowed. */}
      <div className="mt-3">
        <div
          className="relative h-2.5 rounded-full overflow-hidden"
          style={{ background: "var(--line-soft)" }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${pct}%`,
              background: color,
              transition: "width .6s cubic-bezier(.22,.61,.36,1), background .4s",
            }}
          />
          {/* Overflow sliver: how far past the allowance we've gone. */}
          {overPct > 0 && (
            <div
              className="absolute inset-y-0 right-0"
              style={{
                width: `${overPct}%`,
                background:
                  "repeating-linear-gradient(45deg, var(--danger) 0 4px, var(--danger-soft) 4px 8px)",
                opacity: 0.9,
              }}
            />
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11.5px]">
          <span style={muted}>
            <span className="num" style={{ color: "var(--ink)" }}>
              {formatDurationSeconds(s.usedSeconds)}
            </span>{" "}
            used
          </span>
          <span style={muted}>
            of{" "}
            <span className="num" style={{ color: "var(--ink)" }}>
              {formatDurationSeconds(s.allowedSeconds)}
            </span>{" "}
            allowed
          </span>
        </div>
      </div>

      {/* Provenance: window start, freshness, basis. */}
      <div className="text-[11.5px] mt-2.5 space-y-0.5" style={muted}>
        <div>
          Counting from {formatInstant(new Date(s.window.start), timeZone)}
        </div>
        <div className="flex items-center gap-1.5">
          <span>
            As of{" "}
            <span className="num">
              {formatInstant(new Date(s.asOf), timeZone)}
            </span>
          </span>
          {now && (
            <span style={{ opacity: 0.7 }}>
              · port clock{" "}
              <span className="num">
                {new Intl.DateTimeFormat("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                  timeZone,
                }).format(now)}
              </span>
            </span>
          )}
          {refreshing && <span style={{ opacity: 0.7 }}>· updating…</span>}
        </div>
        {!s.quantityIsActual && (
          <div>
            Provisional — allowance from planned quantity. The settled figure
            will use the actual quantity.
          </div>
        )}
      </div>

      <style>{`@keyframes pcps-ping{75%,100%{transform:scale(2.4);opacity:0}}`}</style>
    </div>
  );
}
