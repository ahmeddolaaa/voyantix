import { describe, it, expect } from "vitest";
import { computePortCall, type PortCallCalcData } from "../compute";
import { settleBalance } from "../../settlement";

/**
 * GOLDEN — MV YUFIX, discharging Gemlik (real reference calculation, printed
 * 12.07.2026). Cargo 5,723.738 t @ 4,000 t/day, "If NOR before 12:00 time
 * counts 14:00 same day", non-reversible, once on demurrage always on
 * demurrage, demurrage USD 6,000/day.
 *
 *   NOR tendered   Mon 06/07/26 08:00  → laytime starts 14:00
 *   Completed      Sun 12/07/26 19:10
 *   Time allowed   1d 10h 21m (1.4309345 d)   → on demurrage Wed 08/07 00:21
 *   Time used      6d 05h 10m
 *   Time lost      4d 18h 49m = 4.78434 days
 *   Demurrage      4.78434 × 6,000 = USD 28,706.04
 *
 * The CP's "Fri 17:00 → Mon 08:00 NTC even if used" never bites: laytime
 * expires on Wednesday, and OODAOD counts everything after that.
 * Gemlik is Europe/Istanbul (UTC+3 all year).
 */
const IST = "Europe/Istanbul";

const data: PortCallCalcData = {
  timeZone: IST,
  term: {
    allowanceBasis: "RATE",
    allowance: "0",
    allowanceUnit: "days",
    allowanceRate: "4000",
    commencementRule: "NOR_TENDERED",
    commencementTimeRule: "MORNING_NOR_1400",
    turnTimeHours: null,
    turnTimeTrigger: null,
    onceOnDemurrage: true,
  },
  version: { excludedWeekdays: [], eiuApplies: true, weatherApplies: false },
  events: [
    { semantic: "NOR_TENDERED", occurredAt: new Date("2026-07-06T05:00:00Z") }, // 08:00 LT
    { semantic: "OPS_COMPLETED", occurredAt: new Date("2026-07-12T16:10:00Z") }, // 19:10 LT
  ],
  stoppages: [],
  stoppageRules: [],
  holidayDates: [],
  workedLocalDates: [],
  actualQuantityMt: "5723.738",
  plannedQuantityMt: null,
};

describe("GOLDEN — MV YUFIX discharge (reference)", () => {
  const r = computePortCall(data);

  it("laytime starts Mon 06/07 14:00 local", () => {
    expect(r.window.start.toISOString()).toBe("2026-07-06T11:00:00.000Z");
  });

  it("allowed = 5,723.738 / 4,000 = 1.4309345 days", () => {
    expect(r.allowedSeconds / 86400).toBeCloseTo(1.4309345, 7);
  });

  it("time used 6d 05h 10m", () => {
    expect(r.balance.usedSeconds).toBe(6 * 86400 + 5 * 3600 + 10 * 60);
  });

  it("time lost 4.78434 days (the reference's printed precision)", () => {
    expect(r.balance.outcome).toBe("EXCEEDED");
    const lostDays = -(r.allowedSeconds - r.balance.usedSeconds) / 86400;
    expect(lostDays).toBeCloseTo(4.78434, 5);
  });

  it("demurrage 4.78434 days × 6,000 = USD 28,706.04 (matches the reference)", () => {
    const s = settleBalance({
      outcome: r.balance.outcome,
      balanceSeconds: r.allowedSeconds - r.balance.usedSeconds,
      demurrageRate: 6000,
      despatchRate: null,
      despatchBasis: null,
    });
    expect(s.kind).toBe("demurrage");
    if (s.kind !== "demurrage") return;
    expect(s.days).toBe(4.78434);
    expect(s.amount).toBe(28706.04);
  });
});
