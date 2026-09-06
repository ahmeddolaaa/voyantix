import { describe, it, expect } from "vitest";
import { runLaytimeEngine, invalidStoppages } from "../laytime-engine";

describe("Laytime Engine — no stoppages", () => {
  it("computes despatch when time used is under the allowed laytime", () => {
    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-01T00:00:00Z",
      laytimeEndTime: "2026-08-02T12:00:00Z", // 1.5 days elapsed
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 10000,
      despatchRatePerDay: 5000,
      stoppages: [],
    });

    expect(result.timeUsedDays).toBeCloseTo(1.5, 4);
    expect(result.timeBalanceDays).toBeCloseTo(1.5, 4);
    expect(result.settlementType).toBe("Despatch");
    expect(result.settlementAmountUsd).toBeCloseTo(1.5 * 5000, 2);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0].currentState).toBe("On Laytime");
  });

  it("computes demurrage when time used exceeds the allowed laytime", () => {
    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-01T00:00:00Z",
      laytimeEndTime: "2026-08-06T00:00:00Z", // 5 days elapsed
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 9990,
      despatchRatePerDay: 5000,
      stoppages: [],
    });

    expect(result.timeUsedDays).toBeCloseTo(5, 4);
    expect(result.timeBalanceDays).toBeCloseTo(-2, 4);
    expect(result.settlementType).toBe("Demurrage");
    expect(result.settlementAmountUsd).toBeCloseTo(2 * 9990, 2);

    // Should split into an On Laytime segment then an On Demurrage segment.
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0].currentState).toBe("On Laytime");
    expect(result.intervals[0].durationHours).toBeCloseTo(72, 2); // 3 days
    expect(result.intervals[1].currentState).toBe("On Demurrage");
    expect(result.intervals[1].durationHours).toBeCloseTo(48, 2); // 2 days
  });
});

describe("Laytime Engine — worked production examples (frozen)", () => {
  // Reproduces VOY-002-equivalent figures: Allowed 3.00d, Time Used 6.17d
  // -> Time Balance -3.17d, Settlement Amount 31,666.67 USD (Demurrage)
  it("matches the VOY-002 worked example", () => {
    const allowedDays = 3;
    const timeUsedDays = 6.17;
    const balance = allowedDays - timeUsedDays; // -3.17
    const impliedRate = 31666.67 / Math.abs(balance);

    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-10T00:00:00Z",
      laytimeEndTime: new Date(
        new Date("2026-08-10T00:00:00Z").getTime() +
          timeUsedDays * 24 * 60 * 60 * 1000
      ).toISOString(),
      allowedLaytimeDays: allowedDays,
      demurrageRatePerDay: impliedRate,
      despatchRatePerDay: 1,
      stoppages: [],
    });

    expect(result.timeBalanceDays).toBeCloseTo(-3.17, 2);
    expect(result.settlementType).toBe("Demurrage");
    expect(result.settlementAmountUsd).toBeCloseTo(31666.67, 1);
  });

  // Reproduces VOY-003-equivalent figures: Allowed 5.00d, Time Used 63.83d
  // -> Time Balance -58.83d, Settlement Amount 352,966.67 USD (Demurrage)
  it("matches the VOY-003 worked example", () => {
    const allowedDays = 5;
    const timeUsedDays = 63.83;
    const balance = allowedDays - timeUsedDays; // -58.83
    const impliedRate = 352966.67 / Math.abs(balance);

    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-10T00:00:00Z",
      laytimeEndTime: new Date(
        new Date("2026-08-10T00:00:00Z").getTime() +
          timeUsedDays * 24 * 60 * 60 * 1000
      ).toISOString(),
      allowedLaytimeDays: allowedDays,
      demurrageRatePerDay: impliedRate,
      despatchRatePerDay: 1,
      stoppages: [],
    });

    expect(result.timeBalanceDays).toBeCloseTo(-58.83, 2);
    expect(result.settlementType).toBe("Demurrage");
    expect(result.settlementAmountUsd).toBeCloseTo(352966.67, 1);
  });
});

describe("Laytime Engine — stoppages", () => {
  it("excludes a stoppage fully inside the window from Time Used", () => {
    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-01T00:00:00Z",
      laytimeEndTime: "2026-08-03T00:00:00Z", // 2 days window
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 10000,
      despatchRatePerDay: 5000,
      stoppages: [
        {
          id: "stop-1",
          reasonId: "r1",
          reasonName: "Weather Delay",
          startTime: "2026-08-01T12:00:00Z",
          endTime: "2026-08-01T18:00:00Z", // 6 hours
        },
      ],
    });

    // 48h window - 6h excluded = 42h counted = 1.75 days
    expect(result.timeUsedDays).toBeCloseTo(1.75, 4);
    expect(result.intervals).toHaveLength(3); // counted, excluded, counted
    expect(result.intervals[1].countedOrExcluded).toBe("Excluded");
    expect(result.intervals[1].relatedStoppageId).toBe("stop-1");
  });

  it("treats an open-ended stoppage (no End Time) as extending to window end", () => {
    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-01T00:00:00Z",
      laytimeEndTime: "2026-08-02T00:00:00Z",
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 10000,
      despatchRatePerDay: 5000,
      stoppages: [
        {
          id: "stop-open",
          reasonId: "r1",
          reasonName: "Crane Breakdown",
          startTime: "2026-08-01T12:00:00Z",
          endTime: null,
        },
      ],
    });

    // Only the first 12 hours are counted; rest is excluded to window end.
    expect(result.timeUsedDays).toBeCloseTo(0.5, 4);
  });

  it("flags a stoppage whose End Time is before its Start Time as invalid, not a negative duration", () => {
    const badStoppages = [
      {
        id: "stop-bad",
        reasonId: "r1",
        reasonName: "Crane Breakdown",
        startTime: "2026-08-24T08:52:00Z",
        endTime: "2026-08-24T08:48:00Z",
      },
    ];

    expect(invalidStoppages(badStoppages)).toHaveLength(1);

    // The engine itself must not silently produce a negative-duration
    // interval for it — it should be excluded from the calculation
    // entirely (normalizeStoppages drops it).
    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-24T00:00:00Z",
      laytimeEndTime: "2026-08-25T00:00:00Z",
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 10000,
      despatchRatePerDay: 5000,
      stoppages: badStoppages,
    });

    expect(result.intervals.every((i) => i.durationHours >= 0)).toBe(true);
    expect(result.timeUsedDays).toBeCloseTo(1, 4); // full day counted, bad stoppage ignored
  });

  it("merges overlapping stoppages into one excluded segment", () => {
    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-01T00:00:00Z",
      laytimeEndTime: "2026-08-02T00:00:00Z",
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 10000,
      despatchRatePerDay: 5000,
      stoppages: [
        {
          id: "s1",
          reasonId: "r1",
          reasonName: "Weather Delay",
          startTime: "2026-08-01T06:00:00Z",
          endTime: "2026-08-01T12:00:00Z",
        },
        {
          id: "s2",
          reasonId: "r2",
          reasonName: "Crane Breakdown",
          startTime: "2026-08-01T10:00:00Z", // overlaps s1
          endTime: "2026-08-01T14:00:00Z",
        },
      ],
    });

    const excluded = result.intervals.filter(
      (i) => i.countedOrExcluded === "Excluded"
    );
    expect(excluded).toHaveLength(1);
    // Merged span: 06:00 -> 14:00 = 8 hours
    expect(excluded[0].durationHours).toBeCloseTo(8, 2);
  });
});

describe("Laytime Engine — multiple shift performance dates (sanity)", () => {
  it("does not require shift performance records to compute laytime (engine is stoppage/window driven)", () => {
    // Shift Performance feeds cargo-quantity tracking, not the laytime
    // clock itself in this model — confirming the engine has no hidden
    // dependency on it.
    const result = runLaytimeEngine({
      laytimeStartTime: "2026-08-01T00:00:00Z",
      laytimeEndTime: "2026-08-02T00:00:00Z",
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 10000,
      despatchRatePerDay: 5000,
      stoppages: [],
    });
    expect(result.timeUsedDays).toBeCloseTo(1, 4);
  });
});
