import { describe, it, expect } from "vitest";
import { formatInstant, formatDurationSeconds, sheetBalanceSeconds } from "../format";

/**
 * The formatter must be a pure function of (instant, timeZone): the same
 * two inputs produce the same string no matter what locale or timezone the
 * host process happens to run in. That property is exactly what stops the
 * SSR/client hydration mismatch — the server (UTC container) and the
 * browser (a viewer's zone) render identical text.
 */

// A fixed absolute instant: 2026-03-15T06:00:00Z.
const instant = new Date("2026-03-15T06:00:00.000Z");

/** Runs fn with process.env.TZ temporarily set, then restores it. */
function withHostTZ<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = prev;
  }
}

describe("formatInstant — timezone", () => {
  it("1. a UTC instant renders in Cairo local time", () => {
    expect(formatInstant(instant, "Africa/Cairo")).toBe("15 Mar 2026, 08:00");
  });

  it("2. the same instant renders differently in another timezone", () => {
    // 06:00Z -> 15:00 in Asia/Tokyo (UTC+9, no DST).
    expect(formatInstant(instant, "Asia/Tokyo")).toBe("15 Mar 2026, 15:00");
  });

  it("3. can cross a calendar day depending on the zone", () => {
    // 06:00Z -> 20:00 the day BEFORE in Pacific/Honolulu (UTC-10).
    expect(formatInstant(new Date("2026-03-15T06:00:00.000Z"), "Pacific/Honolulu"))
      .toBe("14 Mar 2026, 20:00");
  });
});

describe("formatInstant — determinism across host environment", () => {
  it("4. output does not depend on the host timezone (TZ)", () => {
    const a = withHostTZ("America/New_York", () =>
      formatInstant(instant, "Africa/Cairo")
    );
    const b = withHostTZ("Asia/Kolkata", () =>
      formatInstant(instant, "Africa/Cairo")
    );
    const c = withHostTZ("UTC", () => formatInstant(instant, "Africa/Cairo"));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("5. server-like (UTC) and browser-like hosts agree for the same instant + zone", () => {
    const serverLike = withHostTZ("UTC", () =>
      formatInstant(instant, "Africa/Cairo")
    );
    const browserLike = withHostTZ("Africa/Cairo", () =>
      formatInstant(instant, "Africa/Cairo")
    );
    expect(serverLike).toBe(browserLike);
  });

  it("6. the structural format is fixed (24h, day-month-year)", () => {
    const out = formatInstant(instant, "Africa/Cairo");
    expect(out).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);
    expect(out).not.toMatch(/AM|PM/);
  });
});

describe("formatInstant — DST", () => {
  it("7. New York in winter is EST (UTC-5)", () => {
    expect(formatInstant(new Date("2026-01-15T17:00:00.000Z"), "America/New_York"))
      .toBe("15 Jan 2026, 12:00");
  });

  it("8. New York in summer is EDT (UTC-4)", () => {
    expect(formatInstant(new Date("2026-07-15T16:00:00.000Z"), "America/New_York"))
      .toBe("15 Jul 2026, 12:00");
  });
});

describe("sheetBalanceSeconds — balance as the laytime sheets show it", () => {
  it("MY FELLAS: 4d 21h 15m used vs 1d 00h 25m 09s allowed → 3d 20h 50m over", () => {
    const allowed = (3052.403 / 3000) * 86400;
    const used = 4 * 86400 + 21 * 3600 + 15 * 60;
    expect(formatDurationSeconds(sheetBalanceSeconds(allowed, used))).toBe("-3d 20h 50m");
  });

  it("test_2: 20 h used vs 4d 07h 26m 50s allowed → 3d 11h 26m saved", () => {
    const allowed = (10775.767 / 2500) * 86400;
    expect(formatDurationSeconds(sheetBalanceSeconds(allowed, 20 * 3600))).toBe("3d 11h 26m");
  });
});
