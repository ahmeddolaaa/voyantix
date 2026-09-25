/**
 * LAYTIME DAY GRID — the visual reading of a persisted calculation.
 *
 * Pure and display-only: it takes the calculation's window, allowance and
 * persisted intervals (the same rows the time-sheet prints) and lays them out
 * as one row per LOCAL day of the port, one cell per local hour, plus the
 * cumulative "laytime used" curve. It never decides what counts — the engine
 * already did; this only splits counted time into laytime (before the
 * allowance runs out) and demurrage (after), and reads the recorded reasons
 * to mark excepted days and stoppages.
 */

import { getLocalParts, instantFromLocal, localMidnightOf, nextLocalMidnight } from "@/lib/laytime/timezone";

export type GridInterval = {
  start: Date;
  end: Date;
  treatment: "COUNTED" | "EXCLUDED";
  countedFraction: number;
  reasons: readonly string[];
};

export type GridState = "outside" | "laytime" | "demurrage" | "excluded";

/** A run of one state inside one hour cell, as fractions [from, to) of the cell. */
export type GridSegment = { state: GridState; from: number; to: number };

export type GridCell = {
  hour: number;
  segments: GridSegment[];
  /** Excepted calendar time (excluded weekday / holiday) touches this hour. */
  excepted: boolean;
  /** A stoppage touches this hour. */
  stoppage: boolean;
  /** Plain-language description for a tooltip / screen reader. */
  title: string;
};

export type GridDay = {
  key: string; // YYYY-MM-DD (local)
  weekday: string; // Mon…Sun
  date: string; // DD/MM
  cells: GridCell[];
  countedSeconds: number;
  runningSeconds: number;
  status: { tone: "laytime" | "demurrage" | "excluded" | "end"; text: string };
};

export type CurvePoint = { t: Date; used: number };

export type DayGrid = {
  days: GridDay[];
  /** Instant the allowance ran out, or null when laytime was never exceeded. */
  demurrageAt: Date | null;
  /** Cumulative counted seconds over the window, at every state change. */
  curve: CurvePoint[];
};

type Span = {
  start: number;
  end: number;
  state: Exclude<GridState, "outside">;
  fraction: number;
  reasons: readonly string[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EXCEPTED = new Set(["EXCLUDED_WEEKDAY", "HOLIDAY", "EXCEPTED_ON_DEMURRAGE"]);

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function hhmm(ms: number, tz: string) {
  const p = getLocalParts(new Date(ms), tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Split counted intervals at the instant the allowance runs out. */
function toSpans(intervals: readonly GridInterval[], allowedSeconds: number): { spans: Span[]; demurrageAt: number | null } {
  const spans: Span[] = [];
  let used = 0;
  let demurrageAt: number | null = null;
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const iv of sorted) {
    const s = iv.start.getTime();
    const e = iv.end.getTime();
    if (e <= s) continue;
    const f = iv.treatment === "COUNTED" ? iv.countedFraction : 0;
    if (f <= 0) {
      spans.push({ start: s, end: e, state: "excluded", fraction: 0, reasons: iv.reasons });
      continue;
    }
    const counted = ((e - s) / 1000) * f;
    if (used >= allowedSeconds) {
      spans.push({ start: s, end: e, state: "demurrage", fraction: f, reasons: iv.reasons });
    } else if (used + counted <= allowedSeconds) {
      spans.push({ start: s, end: e, state: "laytime", fraction: f, reasons: iv.reasons });
    } else {
      const cut = s + ((allowedSeconds - used) / f) * 1000;
      demurrageAt = cut;
      spans.push({ start: s, end: cut, state: "laytime", fraction: f, reasons: iv.reasons });
      spans.push({ start: cut, end: e, state: "demurrage", fraction: f, reasons: iv.reasons });
    }
    if (demurrageAt === null && used + counted === allowedSeconds && allowedSeconds > 0) demurrageAt = e;
    used += counted;
  }
  return { spans, demurrageAt };
}

function describe(state: GridState, reasons: readonly string[]): string {
  if (state === "outside") return "outside the laytime window";
  const stop = reasons.includes("STOPPAGE_EXCLUDED");
  const exc = reasons.some((r) => EXCEPTED.has(r));
  const cause = stop ? "stoppage" : exc ? "excepted day" : null;
  if (state === "excluded") return cause ? `not counted – ${cause}` : "not counted";
  if (state === "demurrage") return cause ? `on demurrage – ${cause}, counts` : "on demurrage";
  return cause ? `laytime – ${cause}, counts` : "laytime counting";
}

export function buildDayGrid(input: {
  window: { start: Date; end: Date };
  allowedSeconds: number;
  intervals: readonly GridInterval[];
  timeZone: string;
}): DayGrid {
  const tz = input.timeZone;
  const ws = input.window.start.getTime();
  const we = input.window.end.getTime();
  const { spans, demurrageAt } = toSpans(input.intervals, input.allowedSeconds);

  // Cumulative curve at every span edge.
  const curve: CurvePoint[] = [{ t: new Date(ws), used: 0 }];
  let acc = 0;
  let last = ws;
  for (const sp of spans) {
    if (sp.start > last) curve.push({ t: new Date(sp.start), used: acc });
    acc += ((sp.end - sp.start) / 1000) * sp.fraction;
    curve.push({ t: new Date(sp.end), used: acc });
    last = sp.end;
  }

  const days: GridDay[] = [];
  let running = 0;
  if (we > ws) {
    let dayStart = localMidnightOf(new Date(ws), tz).getTime();
    while (dayStart < we) {
      const dayEnd = nextLocalMidnight(new Date(dayStart), tz).getTime();
      const lp = getLocalParts(new Date(dayStart), tz);
      const cells: GridCell[] = [];
      let dayCounted = 0;
      let dayDem = 0;
      let dayLay = 0;
      let dayExcl = 0;
      for (let h = 0; h < 24; h++) {
        const cs = instantFromLocal({ year: lp.year, month: lp.month, day: lp.day, hour: h, minute: 0 }, tz).getTime();
        const ce = h === 23 ? dayEnd : instantFromLocal({ year: lp.year, month: lp.month, day: lp.day, hour: h + 1, minute: 0 }, tz).getTime();
        const len = ce - cs;
        const segs: GridSegment[] = [];
        const notes: string[] = [];
        let excepted = false;
        let stoppage = false;
        const push = (state: GridState, a: number, b: number) => {
          if (b <= a) return;
          const from = (a - cs) / len;
          const to = (b - cs) / len;
          const prev = segs[segs.length - 1];
          if (prev && prev.state === state && Math.abs(prev.to - from) < 1e-9) prev.to = to;
          else segs.push({ state, from, to });
        };
        let cursor = cs;
        for (const sp of spans) {
          const a = Math.max(cs, sp.start);
          const b = Math.min(ce, sp.end);
          if (b <= a) continue;
          if (a > cursor) push("outside", cursor, a);
          push(sp.state, a, b);
          cursor = b;
          if (sp.reasons.some((r) => EXCEPTED.has(r))) excepted = true;
          if (sp.reasons.includes("STOPPAGE_EXCLUDED")) stoppage = true;
          const counted = ((b - a) / 1000) * sp.fraction;
          dayCounted += counted;
          if (sp.state === "demurrage") dayDem += b - a;
          else if (sp.state === "laytime") dayLay += b - a;
          else dayExcl += b - a;
          const d = describe(sp.state, sp.reasons);
          if (!notes.includes(d)) notes.push(d);
        }
        if (cursor < ce) push("outside", cursor, ce);
        cells.push({
          hour: h,
          segments: segs,
          excepted,
          stoppage,
          title: `${WEEKDAYS[lp.weekday]} ${pad(lp.day)}/${pad(lp.month)} ${pad(h)}:00–${pad((h + 1) % 24)}:00 · ${
            notes.length ? notes.join("; ") : "outside the laytime window"
          }`,
        });
      }
      running += dayCounted;
      // Excluded weekdays and holidays are whole local days: when any hour of
      // the day carries the calendar exception, show it across the day's
      // window hours (a stoppage interval on that day records only its own
      // reason, which would otherwise leave gaps in the hatch).
      if (cells.some((c) => c.excepted)) {
        for (const c of cells) if (c.segments.some((sg) => sg.state !== "outside")) c.excepted = true;
      }

      let status: GridDay["status"];
      const exceptedDay = cells.some((c) => c.excepted);
      if (demurrageAt !== null && demurrageAt >= dayStart && demurrageAt < dayEnd) {
        status = { tone: "demurrage", text: `On demurrage ${hhmm(demurrageAt, tz)}` };
      } else if (we > dayStart && we <= dayEnd && we < dayEnd) {
        status = { tone: "end", text: `Ends ${hhmm(we, tz)}` };
      } else if (dayDem > 0) {
        status = { tone: "demurrage", text: exceptedDay ? "Demurrage · excepted" : "Demurrage" };
      } else if (dayLay > 0) {
        status = { tone: "laytime", text: exceptedDay ? "Laytime · excepted" : "Laytime" };
      } else if (dayExcl > 0) {
        status = { tone: "excluded", text: exceptedDay ? "Excepted day" : "Not counted" };
      } else {
        status = { tone: "excluded", text: "—" };
      }

      days.push({
        key: `${lp.year}-${pad(lp.month)}-${pad(lp.day)}`,
        weekday: WEEKDAYS[lp.weekday],
        date: `${pad(lp.day)}/${pad(lp.month)}`,
        cells,
        countedSeconds: dayCounted,
        runningSeconds: running,
        status,
      });
      dayStart = dayEnd;
    }
  }

  return { days, demurrageAt: demurrageAt === null ? null : new Date(demurrageAt), curve };
}
