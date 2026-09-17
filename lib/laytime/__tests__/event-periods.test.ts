import { describe, it, expect } from "vitest";
import { deriveWeatherPeriods, type WeatherEvent } from "../event-periods";

const D = (iso: string) => new Date(iso);
const START = (iso: string): WeatherEvent => ({ semantic: "WEATHER_START", occurredAt: D(iso) });
const END = (iso: string): WeatherEvent => ({ semantic: "WEATHER_END", occurredAt: D(iso) });

const windowEnd = D("2026-06-14T23:59:59.000Z");

describe("deriveWeatherPeriods — pairing", () => {
  it("pairs a single start/end into one period", () => {
    const out = deriveWeatherPeriods(
      [START("2026-06-14T08:00:00Z"), END("2026-06-14T10:00:00Z")],
      windowEnd
    );
    expect(out.length).toBe(1);
    expect(out[0].start.toISOString()).toBe("2026-06-14T08:00:00.000Z");
    expect(out[0].end.toISOString()).toBe("2026-06-14T10:00:00.000Z");
  });

  it("pairs multiple periods in order", () => {
    const out = deriveWeatherPeriods(
      [
        START("2026-06-14T08:00:00Z"),
        END("2026-06-14T09:00:00Z"),
        START("2026-06-14T12:00:00Z"),
        END("2026-06-14T13:30:00Z"),
      ],
      windowEnd
    );
    expect(out.length).toBe(2);
    expect(out[1].start.toISOString()).toBe("2026-06-14T12:00:00.000Z");
    expect(out[1].end.toISOString()).toBe("2026-06-14T13:30:00.000Z");
  });

  it("sorts events chronologically before pairing", () => {
    // Deliberately out of order in the input.
    const out = deriveWeatherPeriods(
      [END("2026-06-14T10:00:00Z"), START("2026-06-14T08:00:00Z")],
      windowEnd
    );
    expect(out.length).toBe(1);
    expect(out[0].start.toISOString()).toBe("2026-06-14T08:00:00.000Z");
  });
});

describe("deriveWeatherPeriods — open period", () => {
  it("extends a start with no matching end to the window end", () => {
    const out = deriveWeatherPeriods([START("2026-06-14T20:00:00Z")], windowEnd);
    expect(out.length).toBe(1);
    expect(out[0].start.toISOString()).toBe("2026-06-14T20:00:00.000Z");
    expect(out[0].end.toISOString()).toBe(windowEnd.toISOString());
  });

  it("drops an open start that begins at or after the window end", () => {
    const late = D("2026-06-15T02:00:00Z"); // after windowEnd
    const out = deriveWeatherPeriods([{ semantic: "WEATHER_START", occurredAt: late }], windowEnd);
    expect(out.length).toBe(0);
  });
});

describe("deriveWeatherPeriods — inconsistent data throws", () => {
  it("throws on an end with no open start", () => {
    expect(() =>
      deriveWeatherPeriods([END("2026-06-14T10:00:00Z")], windowEnd)
    ).toThrow();
  });

  it("throws on a start while another is already open", () => {
    expect(() =>
      deriveWeatherPeriods(
        [START("2026-06-14T08:00:00Z"), START("2026-06-14T09:00:00Z")],
        windowEnd
      )
    ).toThrow();
  });
});

describe("deriveWeatherPeriods — edge cases", () => {
  it("drops a zero-length period (end == start)", () => {
    const out = deriveWeatherPeriods(
      [START("2026-06-14T08:00:00Z"), END("2026-06-14T08:00:00Z")],
      windowEnd
    );
    expect(out.length).toBe(0);
  });

  it("returns nothing for no events", () => {
    expect(deriveWeatherPeriods([], windowEnd)).toEqual([]);
  });
});
