"use client";

import { useEffect, useState } from "react";
import { getLoadingOverview, type LoadingOverview } from "@/lib/actions/loading-overview";
import { formatDurationSeconds } from "@/lib/format";
import { getLocalParts } from "@/lib/laytime/timezone";

/**
 * Cargo & loading at a glance for one port call: planned vs handled (by
 * cargo and by crane), today's tonnage, stoppages while working, and the
 * "Will it finish in laytime?" forecast. The forecast is an estimate only —
 * it is not part of any calculation, statement or claim.
 */

const CARGO_COLORS = ["var(--brass)", "var(--teal)", "var(--slate)", "#b7791f", "#7a6a55"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const t = (n: number) => Math.round(n).toLocaleString("en-GB");

function when(d: Date, tz: string) {
  const p = getLocalParts(d, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${WD[p.weekday]} ${pad(p.day)}/${pad(p.month)} · ${pad(p.hour)}:${pad(p.minute)}`;
}

function Bar({ pct, color, h = 10 }: { pct: number; color: string; h?: number }) {
  return (
    <div className="rounded-full overflow-hidden" style={{ height: h, background: "var(--line-soft)" }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

function ForecastCard({ o }: { o: LoadingOverview }) {
  const f = o.forecast;
  const verb = o.fn === "LOAD" ? "loading" : "discharging";
  const shell = "rounded-[14px] p-5 flex flex-col gap-4 lg:w-[380px] shrink-0";
  const bg = { background: "linear-gradient(160deg, var(--navy) 0%, var(--navy-2) 100%)", color: "#fff" } as const;

  if (f.kind === "unavailable") {
    return (
      <section className={shell} style={bg} aria-label="Finish forecast">
        <h3 className="m-0 font-display text-[17px] font-semibold text-white">Will it finish in laytime?</h3>
        <p className="m-0 text-[13px] leading-relaxed" style={{ color: "#b7c9cc" }}>
          {f.message}
        </p>
      </section>
    );
  }

  const bal = f.balanceAtFinishSeconds;
  const chip =
    bal < 0
      ? { bg: "rgba(196,71,47,.22)", fg: "#f2b3a5", text: `Over laytime by ${formatDurationSeconds(-bal)} at this pace` }
      : bal < 6 * 3600
        ? { bg: "rgba(233,199,127,.16)", fg: "var(--brass-light)", text: `Tight — ${formatDurationSeconds(bal)} to spare` }
        : { bg: "rgba(95,194,182,.16)", fg: "#8fd9cf", text: `On track — ${formatDurationSeconds(bal)} to spare` };
  const needed = f.neededPaceMtPerDay;
  const scale = Math.max(f.paceMtPerDay, needed ?? 0, 1);

  return (
    <section className={shell} style={bg} aria-label="Finish forecast">
      <h3 className="m-0 font-display text-[17px] font-semibold text-white">Will it finish in laytime?</h3>
      <div className="flex flex-col gap-1">
        <span className="text-[12px]" style={{ color: "#8fa7ac" }}>
          At the current pace, {verb} completes
        </span>
        <span className="num text-[24px] font-semibold text-white">{when(f.finishAt, o.timeZone)}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[12px]" style={{ color: "#8fa7ac" }}>
          Laytime runs out
        </span>
        <span className="num text-[16px] font-semibold" style={{ color: "var(--brass-light)" }}>
          {f.onDemurrageNow
            ? "Already on demurrage"
            : f.laytimeRunsOutAt
              ? when(f.laytimeRunsOutAt, o.timeZone)
              : "Not within 60 days"}
        </span>
      </div>
      <span
        className="self-start inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold"
        style={{ background: chip.bg, color: chip.fg }}
      >
        {chip.text}
      </span>
      <div className="flex flex-col gap-2.5 pt-3.5" style={{ borderTop: "1px solid rgba(255,255,255,.12)" }}>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[12.5px]">
            <span style={{ color: "#b7c9cc" }}>Current pace</span>
            <span className="num font-semibold">{t(f.paceMtPerDay)} MT/day</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.12)" }}>
            <div className="h-full" style={{ width: `${(f.paceMtPerDay / scale) * 100}%`, background: "#5fc2b6" }} />
          </div>
        </div>
        {needed !== null && needed > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[12.5px]">
              <span style={{ color: "#b7c9cc" }}>Needed to finish in laytime</span>
              <span className="num font-semibold">{t(needed)} MT/day</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.12)" }}>
              <div className="h-full" style={{ width: `${(needed / scale) * 100}%`, background: "var(--brass-light)" }} />
            </div>
          </div>
        )}
      </div>
      <p className="m-0 text-[12px] leading-relaxed" style={{ color: "#8fa7ac" }}>
        Estimate only — not part of the statement. Pace is tonnes handled ÷ time since operations commenced.
      </p>
    </section>
  );
}

export function PortCallLoadingOverview({
  portCallId,
  refreshKey,
}: {
  portCallId: string;
  refreshKey?: string | number | null;
}) {
  const [o, setO] = useState<LoadingOverview | null>(null);

  useEffect(() => {
    let live = true;
    void getLoadingOverview(portCallId).then((r) => {
      if (live) setO(r.ok ? r.data : null);
    });
    return () => {
      live = false;
    };
  }, [portCallId, refreshKey]);

  if (!o || o.plannedMt <= 0) return null;

  const pct = (o.handledMt / o.plannedMt) * 100;
  const verb = o.fn === "LOAD" ? "loaded" : "discharged";
  const pace = o.forecast.kind === "forecast" ? `${t(o.forecast.paceMtPerDay)} MT/day` : "—";
  const stats = [
    { k: "Commenced", v: o.commencedAt ? when(o.commencedAt, o.timeZone) : "—" },
    { k: "Average pace", v: pace },
    { k: "Today so far", v: `${t(o.todayMt)} MT` },
    { k: "Stoppages", v: o.stoppages.count ? `${o.stoppages.count} · ${formatDurationSeconds(o.stoppages.seconds)}` : "none" },
  ];
  const craneMax = Math.max(1, ...o.byCrane.map((c) => c.mt));

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-stretch mb-6">
      <section
        aria-label="Cargo progress"
        className="flex-1 min-w-0 rounded-[14px] p-5 flex flex-col gap-4"
        style={{ border: "1px solid var(--line)", background: "var(--card)" }}
      >
        <div className="flex items-end gap-3 flex-wrap">
          <span className="font-display num text-[40px] font-semibold leading-none" style={{ color: "var(--navy)" }}>
            {t(o.handledMt)}
          </span>
          <span className="text-[14.5px] pb-1" style={{ color: "var(--ink-soft)" }}>
            of {t(o.plannedMt)} MT {verb}
          </span>
          <span className="ml-auto font-display num text-[26px] font-semibold" style={{ color: "var(--brass)" }}>
            {Math.floor(pct)}%
          </span>
        </div>
        <div className="flex h-3.5 rounded-full overflow-hidden" style={{ background: "var(--line-soft)" }}>
          {o.perCargo.map((c, i) => (
            <div
              key={c.cargoId}
              title={`${c.name}: ${t(c.handledMt)} MT`}
              style={{ width: `${(Math.min(c.handledMt, c.plannedMt) / o.plannedMt) * 100}%`, background: CARGO_COLORS[i % CARGO_COLORS.length] }}
            />
          ))}
        </div>
        <div className="flex flex-col">
          {o.perCargo.map((c, i) => (
            <div key={c.cargoId} className="flex flex-col gap-1.5 py-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
              <div className="flex items-baseline gap-2.5">
                <span className="w-2.5 h-2.5 rounded-[3px] self-center" style={{ background: CARGO_COLORS[i % CARGO_COLORS.length] }} />
                <span className="text-[14px] font-semibold">{c.name}</span>
                <span className="num ml-auto text-[13.5px]">
                  <b>{t(c.handledMt)}</b> <span style={{ color: "var(--steel)" }}>/ {t(c.plannedMt)} MT</span>
                </span>
              </div>
              <Bar pct={(c.handledMt / c.plannedMt) * 100} color={CARGO_COLORS[i % CARGO_COLORS.length]} />
              <div className="flex justify-between num text-[12px]" style={{ color: "var(--ink-soft)" }}>
                <span>{Math.floor((c.handledMt / c.plannedMt) * 100)}% {verb}</span>
                <span>{c.handledMt >= c.plannedMt ? "plan reached" : `${t(c.plannedMt - c.handledMt)} MT to go`}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3.5" style={{ borderTop: "1px solid var(--line-soft)" }}>
          {stats.map((s) => (
            <div key={s.k} className="flex flex-col gap-1">
              <span className="text-[12px]" style={{ color: "var(--steel)" }}>
                {s.k}
              </span>
              <span className="num text-[13.5px] font-semibold">{s.v}</span>
            </div>
          ))}
        </div>
        {o.byCrane.length > 0 && (
          <div className="flex flex-col gap-2.5 pt-3.5" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <span className="text-[12px] font-semibold uppercase tracking-[.08em]" style={{ color: "var(--steel)" }}>
              By crane
            </span>
            {o.byCrane.map((c) => (
              <div key={c.crane} className="grid grid-cols-[110px_minmax(0,1fr)_110px_100px] gap-3 items-center text-[13px]">
                <span className="font-medium truncate">{c.crane}</span>
                <Bar pct={(c.mt / craneMax) * 100} color="var(--brass)" h={8} />
                <span className="num text-right font-semibold">{t(c.mt)} MT</span>
                <span className="num text-right text-[12px]" style={{ color: "var(--steel)" }}>
                  today {t(c.todayMt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <ForecastCard o={o} />
    </div>
  );
}
