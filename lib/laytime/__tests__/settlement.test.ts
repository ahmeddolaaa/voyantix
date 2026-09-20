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

  it("refuses a configured despatch because the basis is withheld", () => {
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
      expect(e).toBeInstanceOf(CalculationRefused);
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
