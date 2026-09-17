import { describe, it, expect } from "vitest";
import { partitionAtDayBoundaries, type RawInterval } from "../partition";
import { localMidnightOf, nextLocalMidnight } from "../timezone";

const CAIRO = "Africa/Cairo";

/** Asserts the intervals are contiguous, gap-free, and cover [start,end). */
function assertCovers(
  intervals: RawInterval[],
  start: Date,
  end: Date
): void {
  expect(intervals.length).toBeGreaterThan(0);
  expect(intervals[0].start.getTime()).toBe(start.getTime());
  expect(intervals[intervals.length - 1].end.getTime()).toBe(end.getTime());
  for (let i = 0; i < intervals.length; i++) {
    // each interval is positive-length
    expect(intervals[i].end.getTime()).toBeGreaterThan(
      intervals[i].start.getTime()
    );
    // contiguous: this end equals next start
    if (i < intervals.length - 1) {
      expect(intervals[i].end.getTime()).toBe(intervals[i + 1].start.getTime());
    }
  }
}

describe("partitionAtDayBoundaries — edge cases", () => {
  it("empty window (start == end) yields no intervals", () => {
    const t = new Date("2026-06-10T08:00:00.000Z");
    expect(partitionAtDayBoundaries({ start: t, end: t }, CAIRO)).toEqual([]);
  });

  it("reversed window (start > end) throws", () => {
    const start = new Date("2026-06-10T09:00:00.000Z");
    const end = new Date("2026-06-10T08:00:00.000Z");
    expect(() => partitionAtDayBoundaries({ start, end }, CAIRO)).toThrow();
  });
});

describe("partitionAtDayBoundaries — within a single day", () => {
  it("a window inside one local day yields exactly one interval", () => {
    // Both instants are 2026-06-10 in Cairo (UTC+3 in summer? Cairo is UTC+2,
    // no DST in 2026 assumed here — both are the same local day regardless).
    const start = new Date("2026-06-10T08:00:00.000Z");
    const end = new Date("2026-06-10T14:00:00.000Z");
    const out = partitionAtDayBoundaries({ start, end }, CAIRO);
    expect(out.length).toBe(1);
    assertCovers(out, start, end);
  });
});

describe("partitionAtDayBoundaries — crossing midnights", () => {
  it("a multi-day window is cut at each local midnight", () => {
    // 2026-06-10 20:00Z .. 2026-06-13 06:00Z spans several Cairo midnights.
    const start = new Date("2026-06-10T20:00:00.000Z");
    const end = new Date("2026-06-13T06:00:00.000Z");
    const out = partitionAtDayBoundaries({ start, end }, CAIRO);
    // every internal boundary is a Cairo local midnight (hour 0)
    for (let i = 1; i < out.length; i++) {
      const b = out[i].start;
      // convert via the same zone check
      const localHour = new Intl.DateTimeFormat("en-US", {
        timeZone: CAIRO,
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(b).find((p) => p.type === "hour")?.value;
      expect(localHour === "00" || localHour === "0").toBe(true);
    }
    assertCovers(out, start, end);
  });

  it("a window starting exactly at local midnight", () => {
    // Derive the real local midnight rather than assuming a UTC offset.
    const start = localMidnightOf(new Date("2026-06-10T08:00:00.000Z"), CAIRO);
    const day2 = nextLocalMidnight(start, CAIRO);
    const end = nextLocalMidnight(day2, CAIRO); // exactly two local days later
    const out = partitionAtDayBoundaries({ start, end }, CAIRO);
    expect(out.length).toBe(2);
    assertCovers(out, start, end);
  });

  it("a window ending exactly at local midnight", () => {
    const start = new Date("2026-06-10T08:00:00.000Z");
    // The next local midnight after start is the exact window end.
    const end = nextLocalMidnight(start, CAIRO);
    const out = partitionAtDayBoundaries({ start, end }, CAIRO);
    // Window ends AT the boundary, so exactly one interval, no trailing
    // zero-length slice.
    expect(out.length).toBe(1);
    assertCovers(out, start, end);
  });
});

describe("partitionAtDayBoundaries — DST", () => {
  it("cuts correctly across a DST spring-forward day (New York)", () => {
    const NY = "America/New_York";
    // Around US spring-forward 2026-03-08.
    const start = new Date("2026-03-07T18:00:00.000Z");
    const end = new Date("2026-03-09T18:00:00.000Z");
    const out = partitionAtDayBoundaries({ start, end }, NY);
    assertCovers(out, start, end);
    // internal boundaries are still local midnights
    for (let i = 1; i < out.length; i++) {
      const localHour = new Intl.DateTimeFormat("en-US", {
        timeZone: NY,
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(out[i].start).find((p) => p.type === "hour")?.value;
      expect(localHour === "00" || localHour === "0").toBe(true);
    }
  });

  // Egypt observes summer time. In 2026 the tz database transitions on
  // ~2026-04-24 (spring forward, +2 -> +3, a 23-hour day) and ~2026-10-30
  // (fall back, +3 -> +2, a 25-hour day). Boundaries are derived from the
  // engine's own tz-math so the test does not hardcode a UTC offset.
  function assertLocalMidnights(out: RawInterval[], tz: string): void {
    for (let i = 1; i < out.length; i++) {
      const h = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(out[i].start).find((p) => p.type === "hour")?.value;
      expect(h === "00" || h === "0").toBe(true);
    }
  }

  it("cuts correctly across Egypt spring-forward (~2026-04-24, 23h day)", () => {
    // Start on the local midnight of the transition day, span two local days.
    const start = localMidnightOf(new Date("2026-04-24T09:00:00.000Z"), CAIRO);
    const day2 = nextLocalMidnight(start, CAIRO);
    const end = nextLocalMidnight(day2, CAIRO);
    const out = partitionAtDayBoundaries({ start, end }, CAIRO);
    expect(out.length).toBe(2);
    assertCovers(out, start, end);
    assertLocalMidnights(out, CAIRO);
    // The transition day is 23h long; the first slice must be exactly that.
    expect(out[0].end.getTime() - out[0].start.getTime()).toBe(23 * 3600 * 1000);
  });

  it("cuts correctly across Egypt fall-back (~2026-10-30, 25h day)", () => {
    const start = localMidnightOf(new Date("2026-10-29T09:00:00.000Z"), CAIRO);
    const day2 = nextLocalMidnight(start, CAIRO);
    const end = nextLocalMidnight(day2, CAIRO);
    const out = partitionAtDayBoundaries({ start, end }, CAIRO);
    expect(out.length).toBe(2);
    assertCovers(out, start, end);
    assertLocalMidnights(out, CAIRO);
    // The transition day is 25h long.
    expect(out[0].end.getTime() - out[0].start.getTime()).toBe(25 * 3600 * 1000);
  });
});
