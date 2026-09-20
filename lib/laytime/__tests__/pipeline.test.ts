import { describe, it, expect } from "vitest";
import { calculatePortCall, type PortCallCalcInput } from "../pipeline";
import { localMidnightOf, nextLocalMidnight, getLocalParts } from "../timezone";
import type { StoppageCountability, ClassifiedInterval } from "../classify";
import type { StoppageSpan } from "../event-tagging";
import type { WeatherEvent } from "../event-periods";

const CAIRO = "Africa/Cairo";

// Three consecutive local-day boundaries in Cairo.
const anchor = new Date("2026-06-12T09:00:00Z");
const day0 = localMidnightOf(anchor, CAIRO);
const day1 = nextLocalMidnight(day0, CAIRO);
const day2 = nextLocalMidnight(day1, CAIRO);
const secs = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 1000;

// Exclude whichever weekday day0 falls on, so the test is calendar-robust.
const wd0 = getLocalParts(day0, CAIRO).weekday;

const throwingResolver = (): boolean => {
  throw new Error("didWorkOccur must not be consulted here");
};

const baseInput = (over: Partial<PortCallCalcInput> = {}): PortCallCalcInput => ({
  window: { start: day0, end: day2 },
  timeZone: CAIRO,
  excludedWeekdays: [wd0],
  holidayDates: new Set<string>(),
  weatherApplies: false,
  eiuApplies: true,
  stoppageRules: new Map<string, StoppageCountability>(),
  allowedSeconds: 10 * 86400,
  stoppages: [],
  weatherEvents: [] as WeatherEvent[],
  didWorkOccur: throwingResolver,
  ...over,
});

describe("calculatePortCall — excluded weekday under EIU", () => {
  it("excludes day 0 (its weekday), counts day 1, and never consults the resolver", () => {
    const r = calculatePortCall(baseInput());
    // Only day 1 counts.
    expect(r.balance.usedSeconds).toBe(secs(day1, day2));
    // day 0 interval is excluded by weekday.
    const excluded = r.intervals.filter((i) => i.treatment === "EXCLUDED");
    expect(excluded.some((i) => i.reasons.includes("EXCLUDED_WEEKDAY"))).toBe(true);
    expect(excluded.some((i) => i.reasons.includes("EIU_KEPT_EXCLUDED"))).toBe(true);
  });
});

describe("calculatePortCall — EIU false, used flips the excluded day", () => {
  it("counts both days when the excluded day was worked", () => {
    const r = calculatePortCall(
      baseInput({ eiuApplies: false, didWorkOccur: () => true })
    );
    expect(r.balance.usedSeconds).toBe(secs(day0, day2));
  });

  it("counts only day 1 when the excluded day was not worked", () => {
    const r = calculatePortCall(
      baseInput({ eiuApplies: false, didWorkOccur: () => false })
    );
    expect(r.balance.usedSeconds).toBe(secs(day1, day2));
  });
});

describe("calculatePortCall — a stoppage reduces counted time", () => {
  it("subtracts an AlwaysExcluded stoppage on the counting day", () => {
    const stopStart = new Date(day1.getTime() + 2 * 3600 * 1000);
    const stopEnd = new Date(day1.getTime() + 5 * 3600 * 1000); // 3h
    const stoppages: StoppageSpan[] = [
      { start: stopStart, end: stopEnd, reasonId: "r1" },
    ];
    const rules = new Map<string, StoppageCountability>([["r1", "AlwaysExcluded"]]);
    const r = calculatePortCall(
      baseInput({ stoppages, stoppageRules: rules })
    );
    // day 1 counted minus the 3-hour stoppage.
    expect(r.balance.usedSeconds).toBe(secs(day1, day2) - 3 * 3600);
  });
});

describe("calculatePortCall — balance outcome", () => {
  it("reports SAVED when used is under the allowance", () => {
    const r = calculatePortCall(baseInput({ allowedSeconds: 10 * 86400 }));
    expect(r.balance.outcome).toBe("SAVED");
  });

  it("reports EXCEEDED when used is over the allowance", () => {
    const r = calculatePortCall(baseInput({ allowedSeconds: 3600 }));
    expect(r.balance.outcome).toBe("EXCEEDED");
  });
});

describe("calculatePortCall — the time-sheet covers the window", () => {
  it("intervals are contiguous and span the whole window", () => {
    const r = calculatePortCall(baseInput());
    const sorted = [...r.intervals].sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    );
    expect(sorted[0].start.getTime()).toBe(day0.getTime());
    expect(sorted[sorted.length - 1].end.getTime()).toBe(day2.getTime());
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start.getTime()).toBe(sorted[i - 1].end.getTime());
    }
  });
});
