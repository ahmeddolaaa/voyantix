import { describe, it, expect } from "vitest";
import { applyEiu } from "../eiu";
import type { ClassifiedInterval } from "../classify";

const D = (iso: string) => new Date(iso);

const iv = (over: Partial<ClassifiedInterval> = {}): ClassifiedInterval => ({
  start: D("2026-06-14T08:00:00Z"),
  end: D("2026-06-14T10:00:00Z"),
  treatment: "EXCLUDED",
  eiuRelevant: true,
  reasons: ["EXCLUDED_WEEKDAY"],
  ...over,
});

const never = () => false;
const always = () => true;

describe("applyEiu — non-relevant intervals pass through", () => {
  it("a COUNTED, non-eiuRelevant interval is unchanged", () => {
    const input = iv({ treatment: "COUNTED", eiuRelevant: false, reasons: [] });
    const [out] = applyEiu([input], false, always);
    expect(out).toEqual(input);
  });

  it("a stoppage-excluded (not eiuRelevant) interval is unchanged even under EIU", () => {
    const input = iv({ eiuRelevant: false, reasons: ["STOPPAGE_EXCLUDED"] });
    const [out] = applyEiu([input], false, always);
    expect(out.treatment).toBe("EXCLUDED");
    expect(out.reasons).toEqual(["STOPPAGE_EXCLUDED"]);
  });
});

describe("applyEiu — eiuApplies = true (even if used)", () => {
  it("keeps an excluded weekday excluded and does not consult the resolver", () => {
    let consulted = false;
    const resolver = () => {
      consulted = true;
      return true;
    };
    const [out] = applyEiu([iv()], true, resolver);
    expect(out.treatment).toBe("EXCLUDED");
    expect(out.reasons).toContain("EIU_KEPT_EXCLUDED");
    expect(consulted).toBe(false);
  });
});

describe("applyEiu — eiuApplies = false (unless used)", () => {
  it("flips a worked excluded interval to COUNTED", () => {
    const [out] = applyEiu([iv()], false, always);
    expect(out.treatment).toBe("COUNTED");
    expect(out.reasons).toContain("COUNTED_WHILE_EXCLUDED_USED");
  });

  it("keeps an unworked excluded interval excluded", () => {
    const [out] = applyEiu([iv()], false, never);
    expect(out.treatment).toBe("EXCLUDED");
    expect(out.reasons).toContain("EXCLUDED_NOT_USED");
  });

  it("distinguishes the two excluded cases by their reasons", () => {
    const [worked, idle] = applyEiu([iv(), iv()], false, (i) => i === undefined ? false : false);
    // both idle here
    expect(worked.reasons).toContain("EXCLUDED_NOT_USED");
    expect(idle.reasons).toContain("EXCLUDED_NOT_USED");
  });

  it("propagates a resolver that refuses when 'used' is undefined", () => {
    const refusing = () => {
      throw new Error("USED_UNDEFINED");
    };
    expect(() => applyEiu([iv()], false, refusing)).toThrow("USED_UNDEFINED");
  });
});
