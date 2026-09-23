import { describe, it, expect } from "vitest";
import {
  applyCommencementTimeRule,
  type EngineEvent,
} from "../commencement";
import { calculateFromEvents } from "../window";
import { getLocalParts, instantFromLocal } from "../timezone";
import { CalculationRefused } from "../refuse";

const CAIRO = "Africa/Cairo";

/** Build a UTC instant from a Cairo local wall-clock, for readable fixtures. */
function cairo(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): Date {
  return instantFromLocal({ year, month, day, hour, minute }, CAIRO);
}

describe("commencement time-of-day rule", () => {
  it("AT_EVENT returns the basis instant unchanged", () => {
    const basis = cairo(2026, 6, 23, 8, 0);
    expect(
      applyCommencementTimeRule(basis, "AT_EVENT", CAIRO).getTime()
    ).toBe(basis.getTime());
  });

  it("MORNING_NOR_1400: notice before noon commences 14:00 local same day", () => {
    // MY FELLAS loading: NOR accepted 23/06 08:00 LT -> laytime commences 14:00.
    const start = applyCommencementTimeRule(
      cairo(2026, 6, 23, 8, 0),
      "MORNING_NOR_1400",
      CAIRO
    );
    const p = getLocalParts(start, CAIRO);
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([
      2026, 6, 23, 14, 0,
    ]);
  });

  it("MORNING_NOR_1400: a 10:30 notice still commences 14:00 (discharge case)", () => {
    // MY FELLAS discharge: NOR accepted 09/07 10:30 LT -> laytime commences 14:00.
    const start = applyCommencementTimeRule(
      cairo(2026, 7, 9, 10, 30),
      "MORNING_NOR_1400",
      CAIRO
    );
    const p = getLocalParts(start, CAIRO);
    expect([p.hour, p.minute]).toEqual([14, 0]);
  });

  it("MORNING_NOR_1400: a notice at exactly 12:00 is still the same-day 14:00 branch", () => {
    // Amended GENCON 6(c): "up to and including 12.00 hours".
    const start = applyCommencementTimeRule(
      cairo(2026, 6, 23, 12, 0),
      "MORNING_NOR_1400",
      CAIRO,
      NO_EXCLUSIONS
    );
    const p = getLocalParts(start, CAIRO);
    expect([p.day, p.hour, p.minute]).toEqual([23, 14, 0]);
  });
});

/** A calendar with no excluded weekdays and no holidays. */
const NO_EXCLUSIONS = { excludedWeekdays: [] as number[], holidayDates: new Set<string>() };

describe("MORNING_NOR_1400 — after 12:00 → 08:00 next working day (amended GENCON 6(c))", () => {
  const localOf = (d: Date) => {
    const p = getLocalParts(d, CAIRO);
    return [p.year, p.month, p.day, p.hour, p.minute];
  };

  it("12:01 on Tue 23/06 commences Wed 24/06 08:00", () => {
    const start = applyCommencementTimeRule(
      cairo(2026, 6, 23, 12, 1),
      "MORNING_NOR_1400",
      CAIRO,
      NO_EXCLUSIONS
    );
    expect(localOf(start)).toEqual([2026, 6, 24, 8, 0]);
  });

  it("an evening notice (22:30) still takes the next-working-day branch", () => {
    const start = applyCommencementTimeRule(
      cairo(2026, 6, 23, 22, 30),
      "MORNING_NOR_1400",
      CAIRO,
      NO_EXCLUSIONS
    );
    expect(localOf(start)).toEqual([2026, 6, 24, 8, 0]);
  });

  it("skips an excluded weekday: Thu 25/06 15:30 with Friday excluded → Sat 27/06 08:00", () => {
    const start = applyCommencementTimeRule(
      cairo(2026, 6, 25, 15, 30),
      "MORNING_NOR_1400",
      CAIRO,
      { excludedWeekdays: [5], holidayDates: new Set<string>() }
    );
    expect(localOf(start)).toEqual([2026, 6, 27, 8, 0]);
  });

  it("skips a holiday too: Friday excluded + Sat 27/06 holiday → Sun 28/06 08:00", () => {
    const start = applyCommencementTimeRule(
      cairo(2026, 6, 25, 15, 30),
      "MORNING_NOR_1400",
      CAIRO,
      { excludedWeekdays: [5], holidayDates: new Set(["2026-06-27"]) }
    );
    expect(localOf(start)).toEqual([2026, 6, 28, 8, 0]);
  });

  it("crosses a month end: Tue 30/06 13:00 → Wed 01/07 08:00", () => {
    const start = applyCommencementTimeRule(
      cairo(2026, 6, 30, 13, 0),
      "MORNING_NOR_1400",
      CAIRO,
      NO_EXCLUSIONS
    );
    expect(localOf(start)).toEqual([2026, 7, 1, 8, 0]);
  });

  it("refuses when the after-noon branch has no calendar to resolve a working day", () => {
    try {
      applyCommencementTimeRule(cairo(2026, 6, 23, 15, 30), "MORNING_NOR_1400", CAIRO);
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("COMMENCEMENT_RULE_NEEDS_CALENDAR");
    }
  });

  it("refuses when the calendar has no working day at all", () => {
    try {
      applyCommencementTimeRule(cairo(2026, 6, 23, 15, 30), "MORNING_NOR_1400", CAIRO, {
        excludedWeekdays: [0, 1, 2, 3, 4, 5, 6],
        holidayDates: new Set<string>(),
      });
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("COMMENCEMENT_NO_WORKING_DAY");
    }
  });

  it("the before-noon branch needs no calendar (existing behaviour unchanged)", () => {
    const start = applyCommencementTimeRule(cairo(2026, 6, 23, 8, 0), "MORNING_NOR_1400", CAIRO);
    expect(localOf(start)).toEqual([2026, 6, 23, 14, 0]);
  });
});

describe("calculateFromEvents honours the commencement rule", () => {
  const events: EngineEvent[] = [
    { semantic: "NOR_ACCEPTED", occurredAt: cairo(2026, 6, 23, 8, 0) },
    { semantic: "OPS_COMPLETED", occurredAt: cairo(2026, 6, 24, 0, 0) },
  ];
  const base = {
    events,
    timeZone: CAIRO,
    commencementRule: "NOR_ACCEPTED",
    turnTimeHours: null,
    turnTimeTrigger: null,
    excludedWeekdays: [] as number[],
    holidayDates: new Set<string>(),
    weatherApplies: false,
    eiuApplies: false,
    stoppageRules: new Map(),
    allowedSeconds: 3600,
    stoppages: [],
    weatherEvents: [],
    didWorkOccur: () => true,
  };

  it("AT_EVENT commences at the event instant (unchanged behaviour)", () => {
    const r = calculateFromEvents(base);
    const p = getLocalParts(r.commencementAt, CAIRO);
    expect([p.hour, p.minute]).toEqual([8, 0]);
  });

  it("MORNING_NOR_1400 commences at 14:00 local", () => {
    const r = calculateFromEvents({
      ...base,
      commencementTimeRule: "MORNING_NOR_1400",
    });
    const p = getLocalParts(r.commencementAt, CAIRO);
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([
      2026, 6, 23, 14, 0,
    ]);
  });
});

describe("calculateFromEvents — after-noon NOR uses the rule set's calendar", () => {
  it("Thu 15:30 NOR with Friday excluded commences Sat 08:00", () => {
    const r = calculateFromEvents({
      events: [
        { semantic: "NOR_ACCEPTED", occurredAt: cairo(2026, 6, 25, 15, 30) },
        { semantic: "OPS_COMPLETED", occurredAt: cairo(2026, 6, 29, 0, 0) },
      ],
      timeZone: CAIRO,
      commencementRule: "NOR_ACCEPTED",
      commencementTimeRule: "MORNING_NOR_1400",
      turnTimeHours: null,
      turnTimeTrigger: null,
      excludedWeekdays: [5],
      holidayDates: new Set<string>(),
      weatherApplies: false,
      eiuApplies: false,
      stoppageRules: new Map(),
      allowedSeconds: 10 * 86400,
      stoppages: [],
      weatherEvents: [],
      didWorkOccur: () => true,
    });
    const p = getLocalParts(r.commencementAt, CAIRO);
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([2026, 6, 27, 8, 0]);
    // Sat 08:00 → Mon 29/06 00:00 = 40 h, none of it on the excluded Friday.
    expect(r.balance.usedSeconds).toBe(40 * 3600);
  });
});
