import { describe, it, expect } from "vitest";
import { allowanceToSeconds } from "../units";
import { CalculationRefused } from "../refuse";

describe("allowanceToSeconds", () => {
  it("converts hours", () => {
    expect(allowanceToSeconds("24", "hours")).toBe(24 * 3600);
    expect(allowanceToSeconds("1", "hour")).toBe(3600);
  });

  it("converts days (running day = 24h)", () => {
    expect(allowanceToSeconds("5", "days")).toBe(5 * 86400);
    expect(allowanceToSeconds("1", "day")).toBe(86400);
  });

  it("is case- and whitespace-insensitive on the unit", () => {
    expect(allowanceToSeconds("2", "  DAYS ")).toBe(2 * 86400);
  });

  it("accepts fractional allowances", () => {
    expect(allowanceToSeconds("2.5", "days")).toBe(2.5 * 86400);
  });

  it("refuses an unrecognised unit rather than guessing", () => {
    try {
      allowanceToSeconds("5", "weather working days");
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("ALLOWANCE_UNIT_UNRECOGNISED");
    }
  });

  it("refuses a non-numeric allowance", () => {
    try {
      allowanceToSeconds("abc", "days");
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("ALLOWANCE_VALUE_INVALID");
    }
  });

  it("refuses a negative allowance", () => {
    try {
      allowanceToSeconds("-1", "days");
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("ALLOWANCE_VALUE_NEGATIVE");
    }
  });
});
