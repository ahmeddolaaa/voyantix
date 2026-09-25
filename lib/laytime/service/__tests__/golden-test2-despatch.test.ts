import { describe, it, expect } from "vitest";
import { computePortCall, type PortCallCalcData } from "../compute";
import { settleBalance } from "../../settlement";

/**
 * GOLDEN — "test_2" laytime sheet (loading, despatch case).
 * 10,775.767 MT @ 2,500 MT/day → allowed 4.3103068 d (4d 07h 26m).
 *   NOR tendered   Thu 28/05/26 08:01
 *   NOR accepted   Mon 01/06/26 08:00
 *   Turn time      Mon 08:00 → Tue 08:00 (24 h from NOR accepted), NTC
 *   Counting       Tue 08:00 → Wed 03/06 04:00 = 20 h
 *   Time saved     3d 11h 26m (3.4769735 d) × $4,375 = $15,211.76 on the sheet
 * The CP's weekend (Thu 14:00 → Sun 08:00) falls before NOR acceptance, so it
 * does not affect the counted window.
 */
const CAIRO = "Africa/Cairo";

const data: PortCallCalcData = {
  timeZone: CAIRO,
  term: {
    allowanceBasis: "RATE",
    allowance: "0",
    allowanceUnit: "days",
    allowanceRate: "2500",
    commencementRule: "NOR_ACCEPTED",
    commencementTimeRule: "AT_EVENT",
    turnTimeHours: "24",
    turnTimeTrigger: "NOR_ACCEPTED",
    onceOnDemurrage: false,
  },
  version: { excludedWeekdays: [], eiuApplies: true, weatherApplies: false },
  events: [
    { semantic: "NOR_TENDERED", occurredAt: new Date("2026-05-28T05:01:00Z") },
    { semantic: "NOR_ACCEPTED", occurredAt: new Date("2026-06-01T05:00:00Z") },
    { semantic: "OPS_COMPLETED", occurredAt: new Date("2026-06-03T01:00:00Z") },
  ],
  stoppages: [],
  stoppageRules: [],
  holidayDates: [],
  workedLocalDates: [],
  actualQuantityMt: "10775.767",
  plannedQuantityMt: null,
};

describe("GOLDEN — test_2 despatch (WTS)", () => {
  const r = computePortCall(data);

  it("counting starts Tue 02/06 08:00 after 24 h turn time", () => {
    expect(r.window.start.toISOString()).toBe("2026-06-02T05:00:00.000Z");
  });

  it("allowed 4.3103068 d, used 20 h, saved 3d 11h 26m", () => {
    expect(r.allowedSeconds / 86400).toBeCloseTo(4.3103068, 7);
    expect(r.balance.usedSeconds).toBe(20 * 3600);
    expect(r.balance.outcome).toBe("SAVED");
    const saved = r.allowedSeconds - r.balance.usedSeconds;
    expect(Math.floor(saved / 86400)).toBe(3);
    expect(Math.floor((saved % 86400) / 3600)).toBe(11);
    expect(Math.floor((saved % 3600) / 60)).toBe(26);
  });

  it("WTS despatch at $4,375/day", () => {
    const s = settleBalance({
      outcome: r.balance.outcome,
      balanceSeconds: r.allowedSeconds - r.balance.usedSeconds,
      demurrageRate: 8750,
      despatchRate: 4375,
      despatchBasis: "WTS",
    });
    expect(s.kind).toBe("despatch");
    if (s.kind !== "despatch") return;
    // Default org rounding (5 dp): 3.47697 × 4,375
    expect(s.days).toBe(3.47697);
    expect(s.amount).toBe(15211.74);
  });

  it("with the EXACT org setting it matches the sheet: $15,211.76", () => {
    const s = settleBalance({
      outcome: r.balance.outcome,
      balanceSeconds: r.allowedSeconds - r.balance.usedSeconds,
      demurrageRate: 8750,
      despatchRate: 4375,
      despatchBasis: "WTS",
      dayPrecision: "EXACT",
    });
    if (s.kind !== "despatch") throw new Error("expected despatch");
    expect(s.amount).toBe(15211.76);
  });
});
