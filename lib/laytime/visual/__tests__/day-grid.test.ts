import { describe, it, expect } from "vitest";
import { buildDayGrid, type GridInterval } from "../day-grid";
import { getLocalParts } from "@/lib/laytime/timezone";

const TZ = "Africa/Cairo"; // UTC+3 in June 2026
const at = (iso: string) => new Date(iso);

describe("buildDayGrid", () => {
  // MY FELLAS loading (golden): laytime 23/06 14:00 → 28/06 11:15 local,
  // allowed 1.017468 days, everything counts (OODAOD over the FSHEX days).
  const window = { start: at("2026-06-23T11:00:00Z"), end: at("2026-06-28T08:15:00Z") };
  const allowed = 1.017468 * 86400;
  const intervals: GridInterval[] = [
    { start: window.start, end: at("2026-06-26T21:00:00Z"), treatment: "COUNTED", countedFraction: 1, reasons: [] },
    { start: at("2026-06-26T21:00:00Z"), end: at("2026-06-27T21:00:00Z"), treatment: "COUNTED", countedFraction: 1, reasons: ["EXCLUDED_WEEKDAY", "EXCEPTED_ON_DEMURRAGE"] },
    { start: at("2026-06-27T21:00:00Z"), end: window.end, treatment: "COUNTED", countedFraction: 1, reasons: [] },
  ];
  const g = buildDayGrid({ window, allowedSeconds: allowed, intervals, timeZone: TZ });

  it("lays out one row per local day of the window", () => {
    expect(g.days.map((d) => `${d.weekday} ${d.date}`)).toEqual([
      "Tue 23/06", "Wed 24/06", "Thu 25/06", "Fri 26/06", "Sat 27/06", "Sun 28/06",
    ]);
    expect(g.days.every((d) => d.cells.length === 24)).toBe(true);
  });

  it("counts per day and running total like the time-sheet", () => {
    expect(g.days.map((d) => Math.round(d.countedSeconds))).toEqual([36000, 86400, 86400, 86400, 86400, 40500]);
    expect(Math.round(g.days[5].runningSeconds)).toBe(4 * 86400 + 21 * 3600 + 15 * 60);
  });

  it("finds the instant the allowance runs out (Wed 14:25 local)", () => {
    const p = getLocalParts(g.demurrageAt!, TZ);
    expect([p.day, p.hour, p.minute]).toEqual([24, 14, 25]);
    expect(g.days[1].status).toEqual({ tone: "demurrage", text: "On demurrage 14:25" });
    const cell = g.days[1].cells[14];
    expect(cell.segments.map((s) => s.state)).toEqual(["laytime", "demurrage"]);
  });

  it("marks excepted days and the end of the window", () => {
    expect(g.days[4].cells.every((c) => c.excepted)).toBe(true);
    expect(g.days[4].status.text).toBe("Demurrage · excepted");
    expect(g.days[5].status).toEqual({ tone: "end", text: "Ends 11:15" });
    expect(g.days[0].cells[13].segments).toEqual([{ state: "outside", from: 0, to: 1 }]);
  });

  it("builds a cumulative curve ending at the used time", () => {
    const last = g.curve[g.curve.length - 1];
    expect(Math.round(last.used)).toBe(422100);
    expect(last.t.getTime()).toBe(window.end.getTime());
  });

  it("keeps excluded stoppages out of the count and flags them", () => {
    const g2 = buildDayGrid({
      window: { start: at("2026-06-23T11:00:00Z"), end: at("2026-06-23T17:00:00Z") },
      allowedSeconds: 86400,
      intervals: [
        { start: at("2026-06-23T11:00:00Z"), end: at("2026-06-23T13:30:00Z"), treatment: "COUNTED", countedFraction: 1, reasons: [] },
        { start: at("2026-06-23T13:30:00Z"), end: at("2026-06-23T15:00:00Z"), treatment: "EXCLUDED", countedFraction: 0, reasons: ["STOPPAGE_EXCLUDED"] },
        { start: at("2026-06-23T15:00:00Z"), end: at("2026-06-23T17:00:00Z"), treatment: "COUNTED", countedFraction: 1, reasons: [] },
      ],
      timeZone: TZ,
    });
    expect(g2.days[0].countedSeconds).toBe(4.5 * 3600);
    expect(g2.days[0].cells[16].stoppage).toBe(true);
    expect(g2.days[0].cells[16].segments.map((s) => s.state)).toEqual(["laytime", "excluded"]);
    expect(g2.demurrageAt).toBeNull();
  });
});
