import { describe, it, expect } from "vitest";
import { resolveTurnTime } from "../turn-time";
import { type EngineEvent } from "../commencement";
import { CalculationRefused } from "../refuse";

const D = (iso: string) => new Date(iso);

const events: EngineEvent[] = [
  { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-14T08:00:00Z") },
  { semantic: "BERTHED", occurredAt: D("2026-06-14T12:00:00Z") },
];

describe("resolveTurnTime — no turn time configured", () => {
  it("returns null when hours is null", () => {
    expect(resolveTurnTime(events, null, "NOR_ACCEPTED")).toBeNull();
  });
  it("returns null when hours is zero", () => {
    expect(resolveTurnTime(events, 0, "NOR_ACCEPTED")).toBeNull();
  });
});

describe("resolveTurnTime — configured", () => {
  it("produces a non-countable interval of the given hours from the trigger", () => {
    const tt = resolveTurnTime(events, 24, "NOR_ACCEPTED");
    expect(tt).not.toBeNull();
    expect(tt!.interval.start.toISOString()).toBe("2026-06-14T08:00:00.000Z");
    expect(tt!.interval.end.toISOString()).toBe("2026-06-15T08:00:00.000Z");
    expect(tt!.endsAt.toISOString()).toBe("2026-06-15T08:00:00.000Z");
  });

  it("runs from whichever trigger the contract configures", () => {
    const tt = resolveTurnTime(events, 6, "BERTHED");
    expect(tt!.interval.start.toISOString()).toBe("2026-06-14T12:00:00.000Z");
    expect(tt!.endsAt.toISOString()).toBe("2026-06-14T18:00:00.000Z");
  });

  it("supports fractional hours", () => {
    const tt = resolveTurnTime(events, 1.5, "NOR_ACCEPTED");
    expect(tt!.endsAt.toISOString()).toBe("2026-06-14T09:30:00.000Z");
  });
});

describe("resolveTurnTime — refuses rather than guessing", () => {
  const expectRefusal = (fn: () => unknown, code: string) => {
    try {
      fn();
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe(code);
    }
  };

  it("refuses a duration with no trigger", () => {
    expectRefusal(() => resolveTurnTime(events, 24, null), "TURN_TIME_TRIGGER_UNDEFINED");
    expectRefusal(() => resolveTurnTime(events, 24, "  "), "TURN_TIME_TRIGGER_UNDEFINED");
  });

  it("refuses an unrecognised trigger token", () => {
    expectRefusal(() => resolveTurnTime(events, 24, "on arrival"), "TURN_TIME_TRIGGER_UNRECOGNISED");
  });

  it("refuses when the trigger event is missing", () => {
    expectRefusal(() => resolveTurnTime(events, 24, "OPS_COMMENCED"), "TURN_TIME_EVENT_MISSING");
  });

  it("refuses a negative duration", () => {
    expectRefusal(() => resolveTurnTime(events, -3, "NOR_ACCEPTED"), "TURN_TIME_NEGATIVE");
  });
});
