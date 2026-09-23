import { describe, it, expect } from "vitest";
import {
  computePortCall,
  computeProvisionalStatus,
  type PortCallCalcData,
} from "../compute";
import { CalculationRefused } from "../../refuse";
import { getLocalParts } from "../../timezone";
import { toLocalDateKey } from "../../calendar-classification";

const CAIRO = "Africa/Cairo";
const D = (iso: string) => new Date(iso);

// Window: NOR_ACCEPTED 06-12T05:00Z + 24h turn time = 06-13T05:00Z start,
// OPS_COMPLETED 06-15T05:00Z end. Span = 2 days.
const base = (over: Partial<PortCallCalcData> = {}): PortCallCalcData => ({
  timeZone: CAIRO,
  term: {
    allowanceBasis: "FIXED",
    allowance: "10",
    allowanceUnit: "days",
    allowanceRate: null,
    commencementRule: "NOR_ACCEPTED",
    commencementTimeRule: "AT_EVENT",
    turnTimeHours: "24",
    turnTimeTrigger: "NOR_ACCEPTED",
    onceOnDemurrage: false,
  },
  version: { excludedWeekdays: [], eiuApplies: true, weatherApplies: false },
  events: [
    { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
    { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-15T05:00:00Z") },
  ],
  stoppages: [],
  stoppageRules: [],
  holidayDates: [],
  workedLocalDates: [],
  actualQuantityMt: null,
  plannedQuantityMt: null,
  ...over,
});

describe("computePortCall — window + balance", () => {
  it("derives the window and balances a clean call", () => {
    const r = computePortCall(base());
    expect(r.window.start.toISOString()).toBe("2026-06-13T05:00:00.000Z");
    expect(r.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    expect(r.allowedSeconds).toBe(10 * 86400);
    expect(r.balance.usedSeconds).toBe(2 * 86400);
    expect(r.balance.outcome).toBe("SAVED");
  });
});

describe("computePortCall — event channel mapping", () => {
  it("ignores events with no engine semantic", () => {
    const r = computePortCall(
      base({
        events: [
          { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
          { semantic: null, occurredAt: D("2026-06-14T00:00:00Z") },
          { semantic: "PILOT_ABOARD", occurredAt: D("2026-06-14T01:00:00Z") },
          { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-15T05:00:00Z") },
        ],
      })
    );
    expect(r.balance.usedSeconds).toBe(2 * 86400);
  });

  it("routes WEATHER_* to the weather channel, not the window channel", () => {
    const r = computePortCall(
      base({
        events: [
          { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
          { semantic: "WEATHER_START", occurredAt: D("2026-06-14T00:00:00Z") },
          { semantic: "WEATHER_END", occurredAt: D("2026-06-14T06:00:00Z") },
          { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-15T05:00:00Z") },
        ],
      })
    );
    expect(r.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    expect(r.balance.usedSeconds).toBe(2 * 86400);
  });
});

describe("computePortCall — open stoppage closes to the window end", () => {
  it("an open AlwaysExcluded stoppage excludes to window end", () => {
    const r = computePortCall(
      base({
        stoppages: [
          { start: D("2026-06-14T00:00:00Z"), end: null, reasonId: "r1" },
        ],
        stoppageRules: [{ stoppageReasonId: "r1", countability: "AlwaysExcluded" }],
      })
    );
    // Counts only 06-13T05:00Z → 06-14T00:00Z = 19h.
    expect(r.balance.usedSeconds).toBe(19 * 3600);
  });
});

describe("computePortCall — EIU used-set (F24)", () => {
  it("counts an excluded day only when it was worked (eiuApplies=false)", () => {
    const startLocal = getLocalParts(D("2026-06-13T05:00:00Z"), CAIRO);
    const excludedWd = startLocal.weekday;
    const startDayKey = toLocalDateKey(startLocal.year, startLocal.month, startLocal.day);

    const worked = computePortCall(
      base({
        version: { excludedWeekdays: [excludedWd], eiuApplies: false, weatherApplies: false },
        workedLocalDates: [startDayKey],
      })
    );
    const idle = computePortCall(
      base({
        version: { excludedWeekdays: [excludedWd], eiuApplies: false, weatherApplies: false },
        workedLocalDates: [],
      })
    );
    expect(worked.balance.usedSeconds).toBeGreaterThan(idle.balance.usedSeconds);
  });
});

describe("computePortCall — refusals propagate", () => {
  it("refuses an unrecognised allowance unit", () => {
    try {
      computePortCall(base({ term: { ...base().term, allowanceUnit: "widgets" } }));
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("ALLOWANCE_UNIT_UNRECOGNISED");
    }
  });

  it("refuses when the window-ending event is missing", () => {
    try {
      computePortCall(
        base({
          events: [{ semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") }],
        })
      );
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("WINDOW_END_EVENT_MISSING");
    }
  });
});

describe("computePortCall — rate-based allowance", () => {
  // Real MY FELLAS loading: 3052.403 MT / 3000 MT-per-day = 1.017468 days.
  const rateTerm = {
    allowanceBasis: "RATE",
    allowance: "0",
    allowanceUnit: "days",
    allowanceRate: "3000",
    commencementRule: "NOR_ACCEPTED",
    commencementTimeRule: "AT_EVENT",
    turnTimeHours: null,
    turnTimeTrigger: null,
    onceOnDemurrage: false,
  };

  it("computes allowed = actual quantity / rate", () => {
    const r = computePortCall(
      base({ term: rateTerm, actualQuantityMt: "3052.403" })
    );
    // 3052.403 / 3000 * 86400 = 87909.2064 s (= 1d 00h 25m 09s, doc's 1.017468 d)
    expect(r.allowedSeconds).toBeCloseTo(87909.2064, 2);
  });

  it("refuses a rate-based term when no actual quantity is recorded", () => {
    expect(() =>
      computePortCall(base({ term: rateTerm, actualQuantityMt: null }))
    ).toThrow(/actual cargo quantity/i);
  });
});

describe("computeProvisionalStatus — running reference", () => {
  const rateTerm = {
    allowanceBasis: "RATE",
    allowance: "0",
    allowanceUnit: "days",
    allowanceRate: "3000",
    commencementRule: "NOR_ACCEPTED",
    commencementTimeRule: "AT_EVENT",
    turnTimeHours: null,
    turnTimeTrigger: null,
    onceOnDemurrage: false,
  };
  // In progress: NOR accepted, no OPS_COMPLETED yet.
  const events = [
    { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
  ];

  it("uses PLANNED quantity when no actual, flagged provisional", () => {
    const s = computeProvisionalStatus(
      base({ term: rateTerm, events, plannedQuantityMt: "3000", actualQuantityMt: null }),
      D("2026-06-13T05:00:00Z")
    );
    expect(s.quantityIsActual).toBe(false);
    expect(s.allowedSeconds).toBe(86400); // 3000/3000 * 86400 = 1 day
    expect(s.usedSeconds).toBe(86400); // 24h elapsed, nothing excluded
    expect(s.onDemurrage).toBe(false);
  });

  it("flags on-demurrage once used exceeds allowed", () => {
    const s = computeProvisionalStatus(
      base({ term: rateTerm, events, plannedQuantityMt: "3000", actualQuantityMt: null }),
      D("2026-06-14T05:00:00Z")
    );
    expect(s.usedSeconds).toBe(2 * 86400);
    expect(s.remainingSeconds).toBeLessThan(0);
    expect(s.onDemurrage).toBe(true);
  });

  it("prefers ACTUAL quantity when it exists", () => {
    const s = computeProvisionalStatus(
      base({ term: rateTerm, events, plannedQuantityMt: "3000", actualQuantityMt: "1500" }),
      D("2026-06-13T05:00:00Z")
    );
    expect(s.quantityIsActual).toBe(true);
    expect(s.allowedSeconds).toBe(43200); // 1500/3000 * 86400 = 0.5 day
    expect(s.onDemurrage).toBe(true); // 24h used > 12h allowed
  });
});

describe("computePortCall — commencement time rule from the term", () => {
  // MV YUFIX: NOR tendered Mon 06/07/26 08:00 → laytime starts 14:00 same day.
  const events = [
    { semantic: "NOR_TENDERED", occurredAt: D("2026-07-06T05:00:00Z") }, // 08:00 Cairo
    { semantic: "OPS_COMPLETED", occurredAt: D("2026-07-07T21:00:00Z") },
  ];
  const term = (commencementTimeRule: string) => ({
    ...base().term,
    commencementRule: "NOR_TENDERED",
    commencementTimeRule,
    turnTimeHours: null,
    turnTimeTrigger: null,
  });

  it("MORNING_NOR_1400 starts counting at 14:00 local", () => {
    const r = computePortCall(base({ term: term("MORNING_NOR_1400"), events }));
    expect(r.window.start.toISOString()).toBe("2026-07-06T11:00:00.000Z"); // 14:00 Cairo
  });

  it("AT_EVENT starts at the NOR itself", () => {
    const r = computePortCall(base({ term: term("AT_EVENT"), events }));
    expect(r.window.start.toISOString()).toBe("2026-07-06T05:00:00.000Z");
  });

  it("refuses an unrecognised rule rather than guessing", () => {
    expect(() => computePortCall(base({ term: term("SOMETIMES"), events }))).toThrow(
      CalculationRefused
    );
  });
});
