import { describe, it, expect } from "vitest";
import { forecastFinish } from "../forecast";

const H = 3600_000;
const t0 = new Date("2026-09-22T13:00:00Z"); // operations commenced
const now = new Date(t0.getTime() + 46 * H); // 46 h later

// A clock that counts every second from t0 (no exceptions).
const straight = (t: Date) => Math.max(0, (t.getTime() - t0.getTime()) / 1000);

describe("forecastFinish", () => {
  it("reads pace, finish, run-out and needed pace", () => {
    const f = forecastFinish({
      now,
      commencedAt: t0,
      handledMt: 6420,
      plannedMt: 12500,
      allowedSeconds: 94 * 3600, // runs out 48 h after now
      usedAt: straight,
    });
    if (f.kind !== "forecast") throw new Error(f.kind);
    expect(f.paceMtPerDay).toBeCloseTo(6420 / (46 / 24), 6);
    expect(f.remainingMt).toBe(6080);
    const hoursToFinish = (f.finishAt.getTime() - now.getTime()) / H;
    expect(hoursToFinish).toBeCloseTo(6080 / (6420 / 46), 3);
    expect(Math.abs(f.laytimeRunsOutAt!.getTime() - (now.getTime() + 48 * H))).toBeLessThanOrEqual(60_000);
    expect(f.neededPaceMtPerDay!).toBeCloseTo(6080 / 2, -1); // run-out is bisected to the minute
    expect(f.balanceAtFinishSeconds).toBeCloseTo(94 * 3600 - (46 + hoursToFinish) * 3600, 0);
    expect(f.onDemurrageNow).toBe(false);
  });

  it("honours time the engine does not count (e.g. an excepted day)", () => {
    // Nothing counts during the 24 h after now: run-out moves a day later.
    const paused = (t: Date) => {
      const ms = t.getTime();
      const until = Math.min(ms, now.getTime()) - t0.getTime();
      const after = Math.max(0, ms - (now.getTime() + 24 * H));
      return Math.max(0, until + after) / 1000;
    };
    const f = forecastFinish({ now, commencedAt: t0, handledMt: 6420, plannedMt: 12500, allowedSeconds: 94 * 3600, usedAt: paused });
    if (f.kind !== "forecast") throw new Error(f.kind);
    expect(Math.abs(f.laytimeRunsOutAt!.getTime() - (now.getTime() + 72 * H))).toBeLessThanOrEqual(60_000);
  });

  it("reports demurrage already running", () => {
    const f = forecastFinish({ now, commencedAt: t0, handledMt: 3000, plannedMt: 12500, allowedSeconds: 10 * 3600, usedAt: straight });
    if (f.kind !== "forecast") throw new Error(f.kind);
    expect(f.onDemurrageNow).toBe(true);
    expect(f.laytimeRunsOutAt).toBeNull();
    expect(f.neededPaceMtPerDay).toBeNull();
    expect(f.balanceAtFinishSeconds).toBeLessThan(0);
  });

  it("explains when it cannot forecast", () => {
    const base = { now, allowedSeconds: 1, usedAt: straight };
    expect(forecastFinish({ ...base, commencedAt: t0, handledMt: 0, plannedMt: 0 }).kind).toBe("unavailable");
    expect(forecastFinish({ ...base, commencedAt: null, handledMt: 10, plannedMt: 100 })).toMatchObject({ reason: "NOT_COMMENCED" });
    expect(forecastFinish({ ...base, commencedAt: new Date(now.getTime() - 10 * 60_000), handledMt: 10, plannedMt: 100 })).toMatchObject({ reason: "TOO_EARLY" });
    expect(forecastFinish({ ...base, commencedAt: t0, handledMt: 0, plannedMt: 100 })).toMatchObject({ reason: "NO_TONNAGE" });
    expect(forecastFinish({ ...base, commencedAt: t0, handledMt: 100, plannedMt: 100 })).toMatchObject({ reason: "PLAN_REACHED" });
  });
});
