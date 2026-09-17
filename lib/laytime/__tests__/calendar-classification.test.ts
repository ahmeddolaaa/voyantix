import { describe, it, expect } from "vitest";
import {
  classifyIntervalCalendar,
  classifyIntervalsCalendar,
  type CalendarInputs,
} from "../calendar-classification";
import { localMidnightOf, nextLocalMidnight } from "../timezone";
import { partitionAtDayBoundaries } from "../partition";

const CAIRO = "Africa/Cairo";

const noExclusions: CalendarInputs = {
  excludedWeekdays: [],
  holidayDates: new Set<string>(),
};

describe("classifyIntervalCalendar — day facts", () => {
  it("reads the local date and weekday in the port zone", () => {
    // 2026-06-14 is a Sunday. 08:00 Cairo local.
    const start = new Date("2026-06-14T05:00:00.000Z"); // 08:00 Cairo (UTC+3 summer)
    const end = new Date("2026-06-14T09:00:00.000Z");
    const c = classifyIntervalCalendar({ start, end }, CAIRO, noExclusions);
    expect(c.localDate).toBe("2026-06-14");
    expect(c.weekday).toBe(0); // Sunday
    expect(c.isExcludedWeekday).toBe(false);
    expect(c.isHoliday).toBe(false);
  });

  it("flags an excluded weekday when the weekday is configured", () => {
    // 2026-06-12 is a Friday (weekday 5).
    const start = new Date("2026-06-12T09:00:00.000Z");
    const end = new Date("2026-06-12T11:00:00.000Z");
    const c = classifyIntervalCalendar({ start, end }, CAIRO, {
      excludedWeekdays: [5], // Friday, as data
      holidayDates: new Set(),
    });
    expect(c.weekday).toBe(5);
    expect(c.isExcludedWeekday).toBe(true);
  });

  it("does not flag a weekday that is not configured", () => {
    // Same Friday, but excludedWeekdays does not include it.
    const start = new Date("2026-06-12T09:00:00.000Z");
    const end = new Date("2026-06-12T11:00:00.000Z");
    const c = classifyIntervalCalendar({ start, end }, CAIRO, {
      excludedWeekdays: [0], // only Sunday excluded
      holidayDates: new Set(),
    });
    expect(c.isExcludedWeekday).toBe(false);
  });

  it("flags a holiday when the local date is in the calendar", () => {
    const start = new Date("2026-06-15T09:00:00.000Z");
    const end = new Date("2026-06-15T11:00:00.000Z");
    const c = classifyIntervalCalendar({ start, end }, CAIRO, {
      excludedWeekdays: [],
      holidayDates: new Set(["2026-06-15"]),
    });
    expect(c.localDate).toBe("2026-06-15");
    expect(c.isHoliday).toBe(true);
  });

  it("holiday and excluded-weekday are independent facts", () => {
    // A date that is BOTH a Friday and a holiday: both flags set, no
    // precedence decided here (that is withheld B4).
    const start = new Date("2026-06-12T09:00:00.000Z"); // Friday
    const end = new Date("2026-06-12T11:00:00.000Z");
    const c = classifyIntervalCalendar({ start, end }, CAIRO, {
      excludedWeekdays: [5],
      holidayDates: new Set(["2026-06-12"]),
    });
    expect(c.isExcludedWeekday).toBe(true);
    expect(c.isHoliday).toBe(true);
  });
});

describe("classifyIntervalCalendar — half-open day ownership", () => {
  it("takes the local day from start, not the exclusive end", () => {
    // An interval that runs right up to (but not into) the next local
    // midnight belongs to the START day.
    const start = new Date("2026-06-14T15:00:00.000Z"); // 18:00 Cairo, the 14th
    const end = nextLocalMidnight(start, CAIRO); // 00:00 of the 15th (exclusive)
    const c = classifyIntervalCalendar({ start, end }, CAIRO, noExclusions);
    expect(c.localDate).toBe("2026-06-14");
  });
});

describe("classifyIntervalsCalendar — over a partitioned window", () => {
  it("classifies each day of a multi-day window", () => {
    const start = localMidnightOf(new Date("2026-06-12T09:00:00.000Z"), CAIRO); // Fri 12th 00:00
    const day2 = nextLocalMidnight(start, CAIRO); // Sat 13th
    const day3 = nextLocalMidnight(day2, CAIRO); // Sun 14th
    const end = nextLocalMidnight(day3, CAIRO); // Mon 15th 00:00
    const intervals = partitionAtDayBoundaries({ start, end }, CAIRO);
    expect(intervals.length).toBe(3);

    const out = classifyIntervalsCalendar(intervals, CAIRO, {
      excludedWeekdays: [5, 6], // Friday + Saturday, as data
      holidayDates: new Set(["2026-06-14"]), // Sunday is a holiday
    });

    expect(out.map((c) => c.localDate)).toEqual([
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
    expect(out[0].isExcludedWeekday).toBe(true); // Fri
    expect(out[1].isExcludedWeekday).toBe(true); // Sat
    expect(out[2].isExcludedWeekday).toBe(false); // Sun (not configured)
    expect(out[2].isHoliday).toBe(true); // Sun is holiday
    expect(out[0].isHoliday).toBe(false);
  });
});
