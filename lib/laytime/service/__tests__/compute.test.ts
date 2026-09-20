import { describe, it, expect } from "vitest";
import { computePortCall, type PortCallCalcData } from "../compute";
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
    allowance: "10",
    allowanceUnit: "days",
    commencementRule: "NOR_ACCEPTED",
    turnTimeHours: "24",
    turnTimeTrigger: "NOR_ACCEPTED",
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
