import { describe, it, expect } from "vitest";
import {
  applyOnceOnDemurrage,
  ON_DEMURRAGE_REASON,
  EXCEPTED_ON_DEMURRAGE_REASON,
} from "../demurrage-state";
import { calculatePortCall } from "../pipeline";
import { instantFromLocal } from "../timezone";
import type { ClassifiedInterval } from "../classify";
import type { StoppageCountability } from "../classify";
import fixture from "../../ingestion/fixtures/my-fellas-loading.extraction.json";

const D = (iso: string) => new Date(iso);
const H = 3600;

const counted = (s: string, e: string): ClassifiedInterval => ({
  start: D(s),
  end: D(e),
  treatment: "COUNTED",
  countedFraction: 1,
  eiuRelevant: false,
  reasons: [],
});
const excluded = (s: string, e: string, reason = "EXCLUDED_WEEKDAY"): ClassifiedInterval => ({
  start: D(s),
  end: D(e),
  treatment: "EXCLUDED",
  countedFraction: 0,
  eiuRelevant: true,
  reasons: [reason],
});

describe("applyOnceOnDemurrage — stage", () => {
  const sheet = [
    counted("2026-06-01T00:00:00Z", "2026-06-01T10:00:00Z"), // 10h
    excluded("2026-06-01T10:00:00Z", "2026-06-01T12:00:00Z"), // 2h excluded
    counted("2026-06-01T12:00:00Z", "2026-06-02T00:00:00Z"), // 12h
    excluded("2026-06-02T00:00:00Z", "2026-06-03T00:00:00Z"), // 24h excluded
  ];

  it("is the identity when disabled", () => {
    const r = applyOnceOnDemurrage(sheet, 15 * H, false);
    expect(r.intervals).toBe(sheet);
    expect(r.expiresAt).toBeNull();
  });

  it("splits at the exact expiry and counts every later interval", () => {
    // 15h allowed: 10h in the first piece, 5h into the third piece.
    const r = applyOnceOnDemurrage(sheet, 15 * H, true);
    expect(r.expiresAt?.toISOString()).toBe("2026-06-01T17:00:00.000Z");
    const [a, b, c1, c2, d] = r.intervals;
    expect(a).toBe(sheet[0]);
    expect(b.treatment).toBe("EXCLUDED"); // before expiry: exception still applies
    expect(c1.end.toISOString()).toBe("2026-06-01T17:00:00.000Z");
    expect(c1.reasons).toEqual([]);
    expect(c2.start.toISOString()).toBe("2026-06-01T17:00:00.000Z");
    expect(c2.reasons).toEqual([ON_DEMURRAGE_REASON]);
    // The excluded day after expiry now counts, keeping its lifted reason.
    expect(d.countedFraction).toBe(1);
    expect(d.reasons).toEqual(["EXCLUDED_WEEKDAY", ON_DEMURRAGE_REASON]);
  });

  it("never expires when the allowance is not used up", () => {
    const r = applyOnceOnDemurrage(sheet, 100 * H, true);
    expect(r.expiresAt).toBeNull();
    expect(r.intervals).toEqual(sheet);
  });

  it("expiring exactly at an interval end does not create an empty piece", () => {
    const r = applyOnceOnDemurrage(sheet, 10 * H, true);
    expect(r.expiresAt?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(r.intervals).toHaveLength(4);
    expect(r.intervals[1].countedFraction).toBe(1);
  });

  it("zero allowance is on demurrage from the first interval", () => {
    const r = applyOnceOnDemurrage(sheet, 0, true);
    expect(r.expiresAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(r.intervals.every((i) => i.countedFraction === 1)).toBe(true);
  });
});

describe("applyOnceOnDemurrage — exceptions (stoppages that still count as excepted)", () => {
  const stop = (s: string, e: string, reasonId: string): ClassifiedInterval => ({
    ...excluded(s, e, "STOPPAGE_EXCLUDED"),
    eiuRelevant: false,
    stoppageReasonId: reasonId,
  });
  const sheet = [
    counted("2026-06-01T00:00:00Z", "2026-06-01T10:00:00Z"), // 10h → expires
    stop("2026-06-01T10:00:00Z", "2026-06-01T14:00:00Z", "BREAKDOWN"), // 4h
    stop("2026-06-01T14:00:00Z", "2026-06-01T16:00:00Z", "LABOUR"), // 2h
    excluded("2026-06-01T16:00:00Z", "2026-06-01T20:00:00Z"), // 4h weekday
  ];

  it("keeps an excepted stoppage excluded after expiry, lifts the rest", () => {
    const r = applyOnceOnDemurrage(sheet, 10 * H, true, new Set(["BREAKDOWN"]));
    const [, breakdown, labour, weekday] = r.intervals;
    expect(breakdown.countedFraction).toBe(0);
    expect(breakdown.reasons).toEqual(["STOPPAGE_EXCLUDED", EXCEPTED_ON_DEMURRAGE_REASON]);
    expect(labour.countedFraction).toBe(1);
    expect(labour.reasons).toEqual(["STOPPAGE_EXCLUDED", ON_DEMURRAGE_REASON]);
    // Calendar exceptions cannot be excepted: they always lift.
    expect(weekday.countedFraction).toBe(1);
  });

  it("an exception has no effect before laytime expires", () => {
    const r = applyOnceOnDemurrage(sheet, 100 * H, true, new Set(["BREAKDOWN"]));
    expect(r.expiresAt).toBeNull();
    expect(r.intervals).toEqual(sheet);
  });
});

describe("OODAOD golden — MY FELLAS loading (real reference calculation)", () => {
  // 3000 MT PWWD FSHEX EIU, 3052.403 MT → allowed 1d 00h 25m (1.017468 days).
  // Laytime Tue 23/06/26 14:00 → documents signed Sun 28/06/26 11:15 (Cairo).
  // Reference: used 4d 21h 15m, on demurrage 3d 20h 50m (3.867949 days).
  const tz = "Africa/Cairo";
  const local = (iso: string) => {
    const [d, t] = iso.split("T");
    const [year, month, day] = d.split("-").map(Number);
    const [hour, minute] = t.split(":").map(Number);
    return instantFromLocal({ year, month, day, hour, minute, second: 0 }, tz);
  };
  const allowedSeconds = (3052.403 / 3000) * 86400;

  const stoppages = (fixture as { stoppages: { startLocal: string; endLocal: string; reasonCategory: string }[] })
    .stoppages.map((s) => ({
      start: local(s.startLocal),
      end: local(s.endLocal),
      reasonId: s.reasonCategory,
    }));
  const stoppageRules = new Map<string, StoppageCountability>(
    stoppages.map((s) => [s.reasonId, "AlwaysExcluded"])
  );

  const run = (onceOnDemurrage: boolean, excepted: string[] = []) =>
    calculatePortCall({
      window: { start: local("2026-06-23T14:00"), end: local("2026-06-28T11:15") },
      timeZone: tz,
      excludedWeekdays: [5], // Friday (FSHEX)
      holidayDates: new Set(),
      weatherApplies: false,
      eiuApplies: true, // excepted even if used
      stoppageRules,
      allowedSeconds,
      onceOnDemurrage,
      demurrageExceptedReasonIds: new Set(excepted),
      stoppages,
      weatherEvents: [],
      didWorkOccur: () => true,
    });

  it("with OODAOD reproduces the reference figures exactly", () => {
    const r = run(true);
    expect(r.balance.usedSeconds).toBe(4 * 86400 + 21 * H + 15 * 60);
    const onDemurrageDays = -r.balance.balanceSeconds / 86400;
    expect(onDemurrageDays).toBeCloseTo(3.867949, 6);
    // Laytime expired Wed 24/06 at 14:25 local, as the reference shows.
    expect(r.demurrageExpiresAt!.getTime()).toBeGreaterThanOrEqual(local("2026-06-24T14:25").getTime());
    expect(r.demurrageExpiresAt!.getTime()).toBeLessThan(local("2026-06-24T14:26").getTime());
  });

  it("excepting PORT_CLOSURE keeps its hours out of the demurrage time", () => {
    // Port closures after expiry: 25/06 20:00–26/06 01:00 (5h) and
    // 27/06 14:30–21:30 (7h) = 12h. The SOF also records a labour break
    // (25/06 21:55–23:20, 1h25m) INSIDE the first closure. The engine's
    // contract is one stoppage per instant (the product rejects overlaps), and
    // tagging attributes that 1h25m to the labour break, which is not
    // excepted — so 12h − 1h25m = 10h35m stays out of the count.
    const r = run(true, ["PORT_CLOSURE"]);
    expect(r.balance.usedSeconds).toBe(4 * 86400 + 21 * H + 15 * 60 - (10 * H + 35 * 60));
  });

  it("without OODAOD the Friday and the stoppages would wrongly be deducted", () => {
    const r = run(false);
    expect(r.balance.usedSeconds).toBeLessThan(4 * 86400 + 21 * H + 15 * 60);
  });
});
