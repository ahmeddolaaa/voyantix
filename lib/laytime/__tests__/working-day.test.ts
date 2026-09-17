import { describe, it, expect } from "vitest";
import {
  splitAtWorkingDay,
  type WorkingDayPiece,
  type WorkingDayWindow,
} from "../working-day";
import { localMidnightOf, nextLocalMidnight, instantFromLocal, getLocalParts } from "../timezone";
import type { RawInterval } from "../partition";

const CAIRO = "Africa/Cairo";

/** The instant of a local clock time on the local day of `anchor`. */
function at(anchor: Date, hour: number, minute = 0): Date {
  const p = getLocalParts(anchor, CAIRO);
  return instantFromLocal(
    { year: p.year, month: p.month, day: p.day, hour, minute, second: 0 },
    CAIRO
  );
}

/** Asserts pieces are contiguous, gap-free, and cover [start,end). */
function assertCovers(pieces: WorkingDayPiece[], iv: RawInterval): void {
  expect(pieces.length).toBeGreaterThan(0);
  expect(pieces[0].start.getTime()).toBe(iv.start.getTime());
  expect(pieces[pieces.length - 1].end.getTime()).toBe(iv.end.getTime());
  for (let i = 0; i < pieces.length; i++) {
    expect(pieces[i].end.getTime()).toBeGreaterThan(pieces[i].start.getTime());
    if (i < pieces.length - 1) {
      expect(pieces[i].end.getTime()).toBe(pieces[i + 1].start.getTime());
    }
  }
}

// A full local day (2026-06-14, Cairo) to work within.
const dayStart = localMidnightOf(new Date("2026-06-14T09:00:00.000Z"), CAIRO);
const dayEnd = nextLocalMidnight(dayStart, CAIRO);
const fullDay: RawInterval = { start: dayStart, end: dayEnd };

describe("splitAtWorkingDay — no window configured", () => {
  it("treats the whole interval as within the working day", () => {
    const win: WorkingDayWindow = { start: null, end: null };
    const out = splitAtWorkingDay(fullDay, CAIRO, win);
    expect(out.length).toBe(1);
    expect(out[0].isWithinWorkingDay).toBe(true);
    assertCovers(out, fullDay);
  });
});

describe("splitAtWorkingDay — same-day window (08:00-17:00)", () => {
  const win: WorkingDayWindow = { start: "08:00", end: "17:00" };

  it("splits a full day into before / within / after", () => {
    const out = splitAtWorkingDay(fullDay, CAIRO, win);
    // 00:00-08:00 (out), 08:00-17:00 (in), 17:00-24:00 (out)
    expect(out.length).toBe(3);
    expect(out.map((p) => p.isWithinWorkingDay)).toEqual([false, true, false]);
    expect(out[1].start.getTime()).toBe(at(dayStart, 8).getTime());
    expect(out[1].end.getTime()).toBe(at(dayStart, 17).getTime());
    assertCovers(out, fullDay);
  });

  it("an interval fully inside the window is all working", () => {
    const iv: RawInterval = { start: at(dayStart, 9), end: at(dayStart, 12) };
    const out = splitAtWorkingDay(iv, CAIRO, win);
    expect(out.length).toBe(1);
    expect(out[0].isWithinWorkingDay).toBe(true);
    assertCovers(out, iv);
  });

  it("an interval fully outside the window is all non-working", () => {
    const iv: RawInterval = { start: at(dayStart, 18), end: at(dayStart, 22) };
    const out = splitAtWorkingDay(iv, CAIRO, win);
    expect(out.length).toBe(1);
    expect(out[0].isWithinWorkingDay).toBe(false);
    assertCovers(out, iv);
  });

  it("an interval straddling the window start", () => {
    const iv: RawInterval = { start: at(dayStart, 6), end: at(dayStart, 10) };
    const out = splitAtWorkingDay(iv, CAIRO, win);
    // 06:00-08:00 (out), 08:00-10:00 (in)
    expect(out.map((p) => p.isWithinWorkingDay)).toEqual([false, true]);
    assertCovers(out, iv);
  });
});

describe("splitAtWorkingDay — window crossing local midnight (22:00-06:00)", () => {
  const win: WorkingDayWindow = { start: "22:00", end: "06:00" };

  it("marks both ends of the day as working, the middle as non-working", () => {
    const out = splitAtWorkingDay(fullDay, CAIRO, win);
    // 00:00-06:00 (in), 06:00-22:00 (out), 22:00-24:00 (in)
    expect(out.length).toBe(3);
    expect(out.map((p) => p.isWithinWorkingDay)).toEqual([true, false, true]);
    expect(out[0].end.getTime()).toBe(at(dayStart, 6).getTime());
    expect(out[2].start.getTime()).toBe(at(dayStart, 22).getTime());
    assertCovers(out, fullDay);
  });
});
