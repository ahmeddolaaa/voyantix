import { describe, it, expect } from "vitest";
import {
  accumulateCountedSeconds,
  computeBalance,
  balancePortCall,
  type CountedLike,
} from "../accumulate";

const D = (iso: string) => new Date(iso);
const HOUR = 3600;
const DAY = 86400;

const seg = (h0: number, h1: number, treatment: "COUNTED" | "EXCLUDED"): CountedLike => ({
  start: D(`2026-06-14T${String(h0).padStart(2, "0")}:00:00Z`),
  end: D(`2026-06-14T${String(h1).padStart(2, "0")}:00:00Z`),
  treatment,
});

describe("accumulateCountedSeconds — fractional counting (E4)", () => {
  it("sums a partial interval pro-rata by its countedFraction", () => {
    const total = accumulateCountedSeconds([
      { start: D("2026-06-14T08:00:00Z"), end: D("2026-06-14T12:00:00Z"), treatment: "COUNTED", countedFraction: 0.5 }, // 4h @ 50% = 2h
      { start: D("2026-06-14T12:00:00Z"), end: D("2026-06-14T14:00:00Z"), treatment: "COUNTED", countedFraction: 1 },   // 2h
    ]);
    expect(total).toBe(4 * HOUR);
  });

  it("derives the fraction from treatment when it is absent (binary/legacy)", () => {
    const total = accumulateCountedSeconds([
      seg(8, 10, "COUNTED"),   // 2h → fraction 1
      seg(10, 12, "EXCLUDED"), // → fraction 0
    ]);
    expect(total).toBe(2 * HOUR);
  });

  it("a zero fraction contributes nothing", () => {
    const total = accumulateCountedSeconds([
      { start: D("2026-06-14T08:00:00Z"), end: D("2026-06-14T12:00:00Z"), treatment: "EXCLUDED", countedFraction: 0 },
    ]);
    expect(total).toBe(0);
  });
});

describe("accumulateCountedSeconds", () => {
  it("sums only COUNTED intervals", () => {
    const total = accumulateCountedSeconds([
      seg(8, 10, "COUNTED"),   // 2h
      seg(10, 12, "EXCLUDED"), // ignored
      seg(12, 15, "COUNTED"),  // 3h
    ]);
    expect(total).toBe(5 * HOUR);
  });

  it("is zero when nothing counts", () => {
    expect(accumulateCountedSeconds([seg(8, 20, "EXCLUDED")])).toBe(0);
  });
});

describe("computeBalance — sign convention", () => {
  it("saved when used is below allowed", () => {
    const b = computeBalance(5 * DAY, 4 * DAY);
    expect(b.balanceSeconds).toBe(1 * DAY);
    expect(b.outcome).toBe("SAVED");
  });
  it("exceeded when used is above allowed", () => {
    const b = computeBalance(5 * DAY, 6 * DAY);
    expect(b.balanceSeconds).toBe(-1 * DAY);
    expect(b.outcome).toBe("EXCEEDED");
  });
  it("exact when equal", () => {
    const b = computeBalance(5 * DAY, 5 * DAY);
    expect(b.balanceSeconds).toBe(0);
    expect(b.outcome).toBe("EXACT");
  });
});

describe("balancePortCall", () => {
  it("accumulates then balances against the resolved allowance", () => {
    const intervals: CountedLike[] = [
      seg(8, 12, "COUNTED"),   // 4h
      seg(12, 14, "EXCLUDED"),
      seg(14, 18, "COUNTED"),  // 4h
    ];
    const b = balancePortCall(intervals, 10 * HOUR);
    expect(b.usedSeconds).toBe(8 * HOUR);
    expect(b.balanceSeconds).toBe(2 * HOUR);
    expect(b.outcome).toBe("SAVED");
  });
});
