import { describe, it, expect } from "vitest";
import { settleBalance } from "../settlement";
import { CalculationRefused } from "../refuse";

describe("settleBalance — demurrage on an exceeded balance", () => {
  it("pro-rates the exceeded time at the per-day rate", () => {
    // Exceeded by 1.5 days at 1000/day → 1500.
    const s = settleBalance({
      outcome: "EXCEEDED",
      balanceSeconds: -1.5 * 86400,
      demurrageRate: 1000,
      despatchRate: null,
      despatchBasis: null,
    });
    expect(s.kind).toBe("demurrage");
    if (s.kind === "demurrage") {
      expect(s.days).toBe(1.5);
      expect(s.amount).toBe(1500);
    }
  });
});

describe("settleBalance — rounding convention (MV YUFIX, i-Magellan)", () => {
  it("rounds days to 5 decimals before applying the rate: 4.78434 × 6,000 = 28,706.04", () => {
    // allowed 5723.738/4000 d, used 6d 05h 10m → lost 4.7843432777… d
    const allowed = (5723.738 / 4000) * 86400;
    const used = 6 * 86400 + 5 * 3600 + 10 * 60;
    const s = settleBalance({
      outcome: "EXCEEDED",
      balanceSeconds: allowed - used,
      demurrageRate: 6000,
      despatchRate: null,
      despatchBasis: null,
    });
    expect(s.kind).toBe("demurrage");
    if (s.kind === "demurrage") {
      expect(s.days).toBe(4.78434);
      expect(s.amount).toBe(28706.04);
    }
  });

  it("amount is rounded to cents", () => {
    // 1 hour over at 1000/day: days 0.04167 → 41.67
    const s = settleBalance({
      outcome: "EXCEEDED",
      balanceSeconds: -3600,
      demurrageRate: 1000,
      despatchRate: null,
      despatchBasis: null,
    });
    if (s.kind === "demurrage") {
      expect(s.days).toBe(0.04167);
      expect(s.amount).toBe(41.67);
    }
  });
});

describe("settleBalance — exact balance", () => {
  it("owes nothing", () => {
    const s = settleBalance({
      outcome: "EXACT",
      balanceSeconds: 0,
      demurrageRate: 1000,
      despatchRate: 500,
      despatchBasis: "all time saved",
    });
    expect(s.kind).toBe("none");
    if (s.kind === "none") expect(s.reason).toBe("EXACT_BALANCE");
  });
});

describe("settleBalance — saved balance", () => {
  it("owes nothing when despatch is not configured", () => {
    const s = settleBalance({
      outcome: "SAVED",
      balanceSeconds: 2 * 86400,
      demurrageRate: 1000,
      despatchRate: null,
      despatchBasis: null,
    });
    expect(s.kind).toBe("none");
    if (s.kind === "none") expect(s.reason).toBe("NO_DESPATCH_CONFIGURED");
  });

  it("WTS: despatch = saved balance × despatch rate (test_2: 3.47697 d × 4,375)", () => {
    const allowed = (10775.767 / 2500) * 86400;
    const used = 20 * 3600;
    const s = settleBalance({
      outcome: "SAVED",
      balanceSeconds: allowed - used,
      demurrageRate: 8750,
      despatchRate: 4375,
      despatchBasis: "WTS",
    });
    expect(s.kind).toBe("despatch");
    if (s.kind === "despatch") {
      expect(s.savedSeconds).toBeCloseTo(allowed - used, 6);
      expect(s.days).toBe(3.47697);
      expect(s.amount).toBe(15211.74); // test_2 prints 15,211.76 on exact days — rounding open
    }
  });

  it("refuses ATS rather than projecting time saved", () => {
    try {
      settleBalance({
        outcome: "SAVED",
        balanceSeconds: 2 * 86400,
        demurrageRate: 1000,
        despatchRate: 500,
        despatchBasis: "ATS",
      });
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("DESPATCH_ATS_UNDEFINED");
    }
  });

  it("refuses an unknown basis", () => {
    try {
      settleBalance({
        outcome: "SAVED",
        balanceSeconds: 2 * 86400,
        demurrageRate: 1000,
        despatchRate: 500,
        despatchBasis: "all time saved",
      });
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("DESPATCH_BASIS_WITHHELD");
    }
  });

  it("refuses a configured despatch even with a null basis", () => {
    try {
      settleBalance({
        outcome: "SAVED",
        balanceSeconds: 86400,
        demurrageRate: 1000,
        despatchRate: 500,
        despatchBasis: null,
      });
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("DESPATCH_BASIS_WITHHELD");
    }
  });
});
