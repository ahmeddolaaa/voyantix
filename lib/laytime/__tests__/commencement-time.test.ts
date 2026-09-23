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

  it("MORNING_NOR_1400: a notice at/after noon is refused, not guessed", () => {
    expect(() =>
      applyCommencementTimeRule(cairo(2026, 6, 23, 12, 0), "MORNING_NOR_1400", CAIRO)
    ).toThrow(CalculationRefused);
    expect(() =>
      applyCommencementTimeRule(cairo(2026, 6, 23, 15, 30), "MORNING_NOR_1400", CAIRO)
    ).toThrow(CalculationRefused);
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
