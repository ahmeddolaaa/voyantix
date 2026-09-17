import { describe, it, expect } from "vitest";
import {
  tagIntervalWithEvents,
  type StoppageSpan,
  type EventTaggedPiece,
} from "../event-tagging";
import type { RawInterval } from "../partition";
import type { WeatherPeriod } from "../event-periods";

const D = (iso: string) => new Date(iso);

// A one-day interval to tag within.
const interval: RawInterval = {
  start: D("2026-06-14T00:00:00Z"),
  end: D("2026-06-14T24:00:00Z"), // = 2026-06-15T00:00Z
};

/** Asserts pieces are contiguous, gap-free, and cover the interval exactly. */
function assertCovers(pieces: EventTaggedPiece[], iv: RawInterval): void {
  expect(pieces.length).toBeGreaterThan(0);
  expect(pieces[0].start.getTime()).toBe(iv.start.getTime());
  expect(pieces[pieces.length - 1].end.getTime()).toBe(iv.end.getTime());
  for (let i = 0; i < pieces.length; i++) {
    expect(pieces[i].end.getTime()).toBeGreaterThan(pieces[i].start.getTime());
    if (i < pieces.length - 1) {
      expect(pieces[i].end.getTime()).toBe(pieces[i + 1].start.getTime());
    }
  }
}

describe("tagIntervalWithEvents — no events", () => {
  it("returns the whole interval untagged", () => {
    const out = tagIntervalWithEvents(interval, [], []);
    expect(out.length).toBe(1);
    expect(out[0].stoppageReasonId).toBeNull();
    expect(out[0].hasWeather).toBe(false);
    assertCovers(out, interval);
  });
});

describe("tagIntervalWithEvents — a stoppage", () => {
  it("cuts the interval and tags the covered piece with the reason", () => {
    const stoppages: StoppageSpan[] = [
      { start: D("2026-06-14T08:00:00Z"), end: D("2026-06-14T10:00:00Z"), reasonId: "reason-shift" },
    ];
    const out = tagIntervalWithEvents(interval, stoppages, []);
    // 00-08 (none), 08-10 (stoppage), 10-24 (none)
    expect(out.length).toBe(3);
    expect(out[0].stoppageReasonId).toBeNull();
    expect(out[1].stoppageReasonId).toBe("reason-shift");
    expect(out[1].start.toISOString()).toBe("2026-06-14T08:00:00.000Z");
    expect(out[1].end.toISOString()).toBe("2026-06-14T10:00:00.000Z");
    expect(out[2].stoppageReasonId).toBeNull();
    assertCovers(out, interval);
  });
});

describe("tagIntervalWithEvents — weather", () => {
  it("cuts the interval and tags the covered piece with weather", () => {
    const weather: WeatherPeriod[] = [
      { start: D("2026-06-14T12:00:00Z"), end: D("2026-06-14T14:00:00Z") },
    ];
    const out = tagIntervalWithEvents(interval, [], weather);
    expect(out.length).toBe(3);
    expect(out[1].hasWeather).toBe(true);
    expect(out[0].hasWeather).toBe(false);
    expect(out[2].hasWeather).toBe(false);
    assertCovers(out, interval);
  });
});

describe("tagIntervalWithEvents — overlapping stoppage and weather", () => {
  it("tags a piece with both facts independently", () => {
    // Stoppage 08-12, weather 10-14: boundaries at 08,10,12,14.
    const stoppages: StoppageSpan[] = [
      { start: D("2026-06-14T08:00:00Z"), end: D("2026-06-14T12:00:00Z"), reasonId: "r1" },
    ];
    const weather: WeatherPeriod[] = [
      { start: D("2026-06-14T10:00:00Z"), end: D("2026-06-14T14:00:00Z") },
    ];
    const out = tagIntervalWithEvents(interval, stoppages, weather);
    // Pieces: 00-08(none), 08-10(stoppage), 10-12(stoppage+weather),
    //         12-14(weather), 14-24(none)
    const p = (s: string) => out.find((x) => x.start.toISOString() === s)!;
    expect(p("2026-06-14T08:00:00.000Z").stoppageReasonId).toBe("r1");
    expect(p("2026-06-14T08:00:00.000Z").hasWeather).toBe(false);
    const both = p("2026-06-14T10:00:00.000Z");
    expect(both.stoppageReasonId).toBe("r1");
    expect(both.hasWeather).toBe(true);
    const wOnly = p("2026-06-14T12:00:00.000Z");
    expect(wOnly.stoppageReasonId).toBeNull();
    expect(wOnly.hasWeather).toBe(true);
    assertCovers(out, interval);
  });
});

describe("tagIntervalWithEvents — event spanning the whole interval", () => {
  it("tags the single piece when a stoppage covers everything", () => {
    const stoppages: StoppageSpan[] = [
      { start: D("2026-06-13T00:00:00Z"), end: D("2026-06-15T00:00:00Z"), reasonId: "long" },
    ];
    const out = tagIntervalWithEvents(interval, stoppages, []);
    expect(out.length).toBe(1);
    expect(out[0].stoppageReasonId).toBe("long");
    assertCovers(out, interval);
  });
});
