import { describe, it, expect } from "vitest";
import {
  classifyInterval,
  classifyIntervals,
  type ClassifyConfig,
  type TaggedFacts,
  type StoppageCountability,
} from "../classify";
import { CalculationRefused } from "../refuse";

const D = (iso: string) => new Date(iso);
const span = { start: D("2026-06-14T08:00:00Z"), end: D("2026-06-14T10:00:00Z") };

const facts = (over: Partial<TaggedFacts> = {}): TaggedFacts => ({
  start: span.start,
  end: span.end,
  isExcludedWeekday: false,
  isHoliday: false,
  hasWeather: false,
  stoppageReasonId: null,
  ...over,
});

const cfg = (over: Partial<ClassifyConfig> = {}): ClassifyConfig => ({
  weatherApplies: false,
  stoppageRules: new Map<string, StoppageCountability>(),
  ...over,
});

describe("classifyInterval — plain time counts", () => {
  it("an unremarkable interval is COUNTED", () => {
    const c = classifyInterval(facts(), cfg());
    expect(c.treatment).toBe("COUNTED");
    expect(c.eiuRelevant).toBe(false);
    expect(c.reasons).toEqual([]);
  });
});

describe("classifyInterval — calendar exclusion (EIU-relevant)", () => {
  it("an excluded weekday is EXCLUDED and eiuRelevant", () => {
    const c = classifyInterval(facts({ isExcludedWeekday: true }), cfg());
    expect(c.treatment).toBe("EXCLUDED");
    expect(c.eiuRelevant).toBe(true);
    expect(c.reasons).toEqual(["EXCLUDED_WEEKDAY"]);
  });

  it("a holiday is EXCLUDED and eiuRelevant", () => {
    const c = classifyInterval(facts({ isHoliday: true }), cfg());
    expect(c.treatment).toBe("EXCLUDED");
    expect(c.reasons).toEqual(["HOLIDAY"]);
  });

  it("weekday AND holiday are excluded once, both reasons recorded (no double-exclude)", () => {
    const c = classifyInterval(facts({ isExcludedWeekday: true, isHoliday: true }), cfg());
    expect(c.treatment).toBe("EXCLUDED");
    expect(c.reasons).toEqual(["EXCLUDED_WEEKDAY", "HOLIDAY"]);
  });
});

describe("classifyInterval — stoppages via ContractStoppageRule", () => {
  it("AlwaysExcluded excludes the interval, not EIU-relevant", () => {
    const rules = new Map<string, StoppageCountability>([["r1", "AlwaysExcluded"]]);
    const c = classifyInterval(facts({ stoppageReasonId: "r1" }), cfg({ stoppageRules: rules }));
    expect(c.treatment).toBe("EXCLUDED");
    expect(c.eiuRelevant).toBe(false);
    expect(c.reasons).toEqual(["STOPPAGE_EXCLUDED"]);
  });

  it("NeverExcluded imposes no exclusion; the interval counts", () => {
    const rules = new Map<string, StoppageCountability>([["r1", "NeverExcluded"]]);
    const c = classifyInterval(facts({ stoppageReasonId: "r1" }), cfg({ stoppageRules: rules }));
    expect(c.treatment).toBe("COUNTED");
  });

  it("NeverExcluded stoppage on an excluded weekday still excludes by the weekday", () => {
    const rules = new Map<string, StoppageCountability>([["r1", "NeverExcluded"]]);
    const c = classifyInterval(
      facts({ stoppageReasonId: "r1", isExcludedWeekday: true }),
      cfg({ stoppageRules: rules })
    );
    expect(c.treatment).toBe("EXCLUDED");
    expect(c.reasons).toEqual(["EXCLUDED_WEEKDAY"]);
  });

  it("refuses a stoppage reason with no contractual rule", () => {
    try {
      classifyInterval(facts({ stoppageReasonId: "unknown" }), cfg());
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("STOPPAGE_RULE_MISSING");
    }
  });

  it("refuses the undefined CountsAgainstOwner balance treatment", () => {
    const rules = new Map<string, StoppageCountability>([["r1", "CountsAgainstOwner"]]);
    try {
      classifyInterval(facts({ stoppageReasonId: "r1" }), cfg({ stoppageRules: rules }));
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("STOPPAGE_OWNER_TREATMENT_UNDEFINED");
    }
  });
});

describe("classifyInterval — weather is isolated", () => {
  it("refuses weather that applies (counting treatment undefined)", () => {
    try {
      classifyInterval(facts({ hasWeather: true }), cfg({ weatherApplies: true }));
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("WEATHER_COUNTING_UNDEFINED");
    }
  });

  it("weather that does not apply has no effect", () => {
    const c = classifyInterval(facts({ hasWeather: true }), cfg({ weatherApplies: false }));
    expect(c.treatment).toBe("COUNTED");
  });
});

describe("classifyIntervals — maps over a list", () => {
  it("classifies each interval", () => {
    const out = classifyIntervals(
      [facts(), facts({ isHoliday: true })],
      cfg()
    );
    expect(out.map((c) => c.treatment)).toEqual(["COUNTED", "EXCLUDED"]);
  });
});
