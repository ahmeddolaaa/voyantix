"use client";

import { useEffect, useMemo, useState } from "react";
import { getPortCallCalculation, type PersistedCalculation } from "@/lib/actions/laytime-calculations";
import { buildDayGrid, type GridCell, type GridState } from "@/lib/laytime/visual/day-grid";
import { formatDurationSeconds, sheetBalanceSeconds } from "@/lib/format";
import { getLocalParts } from "@/lib/laytime/timezone";

/**
 * The picture of a port call's persisted laytime calculation:
 *  - a compact curve card: counted time climbing against the allowance, the
 *    crossing being the moment demurrage starts (option C);
 *  - the day grid: one row per local day, one cell per hour, with counted,
 *    running total and status per day (option B).
 * Display only — it reads the same intervals the time-sheet prints.
 */

const COLORS: Record<GridState, string> = {
  outside: "#f4f1ea",
  excluded: "#d6cfc1",
  laytime: "var(--teal)",
  demurrage: "var(--coral)",
};

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cellBackground(c: GridCell): string {
  if (c.segments.length === 1) return COLORS[c.segments[0].state];
  const stops = c.segments
    .map((s) => `${COLORS[s.state]} ${(s.from * 100).toFixed(2)}% ${(s.to * 100).toFixed(2)}%`)
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

function local(d: Date, tz: string) {
  const p = getLocalParts(d, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${WD[p.weekday]} ${pad(p.day)}/${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
}

function Legend() {
  const item = (bg: string, label: string, extra?: React.CSSProperties) => (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-[3px]" style={{ background: bg, ...extra }} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
      {item("var(--teal)", "Laytime")}
      {item("var(--coral)", "Demurrage")}
      {item("#d6cfc1", "Not counted")}
      {item("repeating-linear-gradient(135deg, var(--coral) 0 3px, #f2b3a5 3px 6px)", "Excepted day")}
      {item("var(--slate)", "Stoppage", { height: 5, marginTop: 4 })}
    </div>
  );
}

function Curve({ calc, timeZone }: { calc: PersistedCalculation; timeZone: string }) {
  const grid = useMemo(
    () =>
      buildDayGrid({
        window: calc.window!,
        allowedSeconds: calc.allowedSeconds ?? 0,
        intervals: calc.intervals,
        timeZone,
      }),
    [calc, timeZone]
  );
  const W = 1000;
  const H = 104;
  const ws = calc.window!.start.getTime();
  const we = calc.window!.end.getTime();
  const allowed = calc.allowedSeconds ?? 0;
  const used = calc.usedSeconds ?? 0;
  const ymax = Math.max(allowed, used, 1) * 1.12;
  const x = (t: number) => ((t - ws) / Math.max(1, we - ws)) * W;
  const y = (v: number) => H - (v / ymax) * H;
  const pts = grid.curve.map((p) => [x(p.t.getTime()), y(p.used)] as const);
  const dem = grid.demurrageAt?.getTime() ?? null;
  const split = dem === null ? pts.length : pts.findIndex(([px]) => px >= x(dem));
  const toPath = (arr: readonly (readonly [number, number])[]) =>
    arr.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const before = dem === null ? pts : [...pts.slice(0, split), [x(dem), y(allowed)] as const];
  const after = dem === null ? [] : [[x(dem), y(allowed)] as const, ...pts.slice(split)];
  const overArea =
    after.length > 1
      ? `${toPath(after)} L${after[after.length - 1][0].toFixed(1)} ${y(allowed).toFixed(1)} Z`
      : null;
  const balance = sheetBalanceSeconds(allowed, used);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px]">
        <span>
          <span style={{ color: "var(--steel)" }}>Allowed </span>
          <span className="num font-semibold">{formatDurationSeconds(allowed)}</span>
        </span>
        <span>
          <span style={{ color: "var(--steel)" }}>Used </span>
          <span className="num font-semibold">{formatDurationSeconds(used)}</span>
        </span>
        <span>
          <span style={{ color: "var(--steel)" }}>{balance < 0 ? "Over laytime " : "Saved "}</span>
          <span className="num font-semibold" style={{ color: balance < 0 ? "var(--coral)" : "var(--teal)" }}>
            {formatDurationSeconds(Math.abs(balance))}
          </span>
        </span>
        {dem !== null && (
          <span className="ml-auto text-[12.5px] font-semibold" style={{ color: "var(--coral)" }}>
            On demurrage from {local(new Date(dem), timeZone)}
          </span>
        )}
      </div>
      <svg
        viewBox={`-2 -8 ${W + 4} ${H + 12}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Laytime used ${formatDurationSeconds(used)} against ${formatDurationSeconds(allowed)} allowed`}
      >
        <defs>
          <linearGradient id="vx-over" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--coral)" stopOpacity=".28" />
            <stop offset="1" stopColor="var(--coral)" stopOpacity=".05" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
        <line x1="0" x2={W} y1={y(allowed)} y2={y(allowed)} stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="6 6" />
        {overArea && <path d={overArea} fill="url(#vx-over)" />}
        <path d={toPath(before)} fill="none" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {after.length > 1 && (
          <path d={toPath(after)} fill="none" stroke="var(--coral)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {dem !== null && (
          <circle cx={x(dem)} cy={y(allowed)} r="6" fill="#fff" stroke="var(--coral)" strokeWidth="3" />
        )}
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="5" fill="var(--brass)" />
      </svg>
    </div>
  );
}

function Grid({ calc, timeZone }: { calc: PersistedCalculation; timeZone: string }) {
  const grid = useMemo(
    () =>
      buildDayGrid({
        window: calc.window!,
        allowedSeconds: calc.allowedSeconds ?? 0,
        intervals: calc.intervals,
        timeZone,
      }),
    [calc, timeZone]
  );
  const toneStyle = {
    laytime: { background: "var(--teal-soft)", color: "var(--teal)" },
    demurrage: { background: "var(--coral-soft)", color: "var(--coral)" },
    excluded: { background: "var(--line-soft)", color: "var(--ink-soft)" },
    end: { background: "var(--rust-soft)", color: "#8a5a12" },
  } as const;
  const cols = "grid grid-cols-[76px_minmax(0,1fr)_96px_104px_176px] gap-3 items-center";

  return (
    <div className="flex flex-col gap-2 overflow-x-auto">
      <div className={`${cols} min-w-[860px]`}>
        <span />
        <div className="grid grid-cols-4 text-[11px] num" style={{ color: "var(--steel)" }}>
          {["00:00", "06:00", "12:00", "18:00"].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-right" style={{ color: "var(--steel)" }}>
          Counted
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-right" style={{ color: "var(--steel)" }}>
          Running
        </span>
        <span />
      </div>
      {grid.days.map((d) => (
        <div key={d.key} className={`${cols} min-w-[860px]`}>
          <div className="flex flex-col leading-tight">
            <span className="text-[13.5px] font-semibold">{d.weekday}</span>
            <span className="num text-[11.5px]" style={{ color: "var(--steel)" }}>
              {d.date}
            </span>
          </div>
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
            {d.cells.map((c) => (
              <div
                key={c.hour}
                title={c.title}
                className="relative h-[30px] rounded-[4px] overflow-hidden"
                style={{ background: cellBackground(c) }}
              >
                {c.excepted && c.segments.some((s) => s.state !== "outside") && (
                  <div
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                      background:
                        "repeating-linear-gradient(135deg, rgba(255,255,255,.4) 0 4px, rgba(255,255,255,0) 4px 8px)",
                    }}
                  />
                )}
                {c.stoppage && (
                  <div
                    aria-hidden
                    className="absolute left-[3px] right-[3px] bottom-[3px] h-[5px] rounded-[3px]"
                    style={{ background: "var(--slate)" }}
                  />
                )}
              </div>
            ))}
          </div>
          <span className="num text-[13px] font-semibold text-right">{formatDurationSeconds(d.countedSeconds)}</span>
          <span className="num text-[13px] text-right" style={{ color: "var(--ink-soft)" }}>
            {formatDurationSeconds(d.runningSeconds)}
          </span>
          <span
            className="justify-self-start inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
            style={toneStyle[d.status.tone]}
          >
            {d.status.text}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PortCallLaytimeVisual({
  portCallId,
  timeZone,
  refreshKey,
}: {
  portCallId: string;
  timeZone: string;
  /** Changes after every recalculation so the picture reloads. */
  refreshKey?: string | number | null;
}) {
  const [calc, setCalc] = useState<PersistedCalculation | null>(null);

  useEffect(() => {
    let live = true;
    void getPortCallCalculation(portCallId).then((r) => {
      if (live) setCalc(r.ok ? r.data : null);
    });
    return () => {
      live = false;
    };
  }, [portCallId, refreshKey]);

  if (!calc || calc.status !== "calculated" || !calc.window || calc.intervals.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 mb-6">
      <section
        aria-label="Laytime used against the allowance"
        className="rounded-xl px-5 py-4"
        style={{ border: "1px solid var(--line)", background: "var(--bg-subtle)" }}
      >
        <Curve calc={calc} timeZone={timeZone} />
      </section>
      <section aria-label="Laytime by day and hour" className="flex flex-col gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className="m-0 font-display text-[16px] font-semibold">Laytime by day</h3>
          <span className="text-[12px]" style={{ color: "var(--steel)" }}>
            local time · hover an hour for detail
          </span>
          <div className="ml-auto">
            <Legend />
          </div>
        </div>
        <Grid calc={calc} timeZone={timeZone} />
      </section>
    </div>
  );
}
