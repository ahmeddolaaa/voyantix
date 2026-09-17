import { describe, it, expect } from "vitest";
import {
  getLocalParts,
  instantFromLocal,
  localMidnightOf,
  nextLocalMidnight,
} from "../timezone";

function withHostTZ<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = prev;
  }
}

describe("getLocalParts", () => {
  it("reads wall-clock parts in the given zone", () => {
    const p = getLocalParts(new Date("2026-03-15T06:00:00.000Z"), "Africa/Cairo");
    expect(p.year).toBe(2026);
    expect(p.month).toBe(3);
    expect(p.day).toBe(15);
    expect(p.hour).toBe(8);
    expect(p.minute).toBe(0);
    expect(p.weekday).toBe(0);
  });

  it("reads a different zone from the same instant", () => {
    const p = getLocalParts(new Date("2026-03-15T06:00:00.000Z"), "Asia/Tokyo");
    expect(p.hour).toBe(15);
    expect(p.day).toBe(15);
  });

  it("does not depend on the host timezone", () => {
    const instant = new Date("2026-03-15T06:00:00.000Z");
    const a = withHostTZ("America/New_York", () => getLocalParts(instant, "Africa/Cairo"));
    const b = withHostTZ("Asia/Kolkata", () => getLocalParts(instant, "Africa/Cairo"));
    expect(a).toEqual(b);
    expect(a.hour).toBe(8);
  });
});

describe("instantFromLocal — round-trips getLocalParts", () => {
  it("recovers the original instant", () => {
    const instant = new Date("2026-03-15T06:00:00.000Z");
    const p = getLocalParts(instant, "Africa/Cairo");
    const back = instantFromLocal(p, "Africa/Cairo");
    expect(back.getTime()).toBe(instant.getTime());
  });

  it("round-trips in a half-hour-offset zone", () => {
    const instant = new Date("2026-07-01T09:17:00.000Z");
    const p = getLocalParts(instant, "Asia/Kolkata");
    const back = instantFromLocal(p, "Asia/Kolkata");
    expect(back.getTime()).toBe(instant.getTime());
  });
});

describe("localMidnightOf", () => {
  it("returns the start of the local day", () => {
    const mid = localMidnightOf(new Date("2026-03-15T06:00:00.000Z"), "Africa/Cairo");
    expect(mid.toISOString()).toBe("2026-03-14T22:00:00.000Z");
    const p = getLocalParts(mid, "Africa/Cairo");
    expect(p.hour).toBe(0);
    expect(p.day).toBe(15);
  });
});

describe("nextLocalMidnight", () => {
  it("advances to the next local midnight on a normal day", () => {
    const next = nextLocalMidnight(new Date("2026-03-15T06:00:00.000Z"), "Africa/Cairo");
    const p = getLocalParts(next, "Africa/Cairo");
    expect(p.hour).toBe(0);
    expect(p.day).toBe(16);
  });

  it("is always local 00:00 regardless of input time of day", () => {
    for (const h of ["00:30", "12:00", "23:59"]) {
      const next = nextLocalMidnight(new Date(`2026-06-10T${h}:00.000Z`), "Africa/Cairo");
      expect(getLocalParts(next, "Africa/Cairo").hour).toBe(0);
    }
  });

  it("DST spring-forward: short day still lands on real next midnight (New York)", () => {
    const duringShortDay = new Date("2026-03-08T10:00:00.000Z");
    const next = nextLocalMidnight(duringShortDay, "America/New_York");
    const p = getLocalParts(next, "America/New_York");
    expect(p.hour).toBe(0);
    expect(p.day).toBe(9);
  });

  it("DST fall-back: long day still lands on real next midnight (New York)", () => {
    const duringLongDay = new Date("2026-11-01T10:00:00.000Z");
    const next = nextLocalMidnight(duringLongDay, "America/New_York");
    const p = getLocalParts(next, "America/New_York");
    expect(p.hour).toBe(0);
    expect(p.day).toBe(2);
  });
});
