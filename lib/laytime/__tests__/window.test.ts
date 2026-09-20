import { describe, it, expect } from "vitest";
import { resolveCandidateWindow, calculateFromEvents } from "../window";
import { type EngineEvent } from "../commencement";
import { CalculationRefused } from "../refuse";
import { localMidnightOf, nextLocalMidnight } from "../timezone";
import type { StoppageCountability } from "../classify";

const D = (iso: string) => new Date(iso);
const CAIRO = "Africa/Cairo";

const events = (over: Partial<Record<string, string>> = {}): EngineEvent[] => {
  const base: Record<string, string> = {
    NOR_ACCEPTED: "2026-06-12T05:00:00Z",
    OPS_COMPLETED: "2026-06-15T05:00:00Z",
    ...over,
  };
  return Object.entries(base).map(([semantic, iso]) => ({
    semantic: semantic as EngineEvent["semantic"],
    occurredAt: D(iso),
  }));
};

describe("resolveCandidateWindow — start derivation", () => {
  it("with turn time: counting begins at trigger + duration", () => {
    const cw = resolveCandidateWindow(events(), "NOR_ACCEPTED", 24, "NOR_ACCEPTED");
    // 05:00Z + 24h = next day 05:00Z
    expect(cw.window.start.toISOString()).toBe("2026-06-13T05:00:00.000Z");
    expect(cw.turnTime).not.toBeNull();
    expect(cw.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
  });

  it("without turn time: counting begins at the commencement basis event", () => {
    const cw = resolveCandidateWindow(events(), "NOR_ACCEPTED", null, null);
    expect(cw.window.start.toISOString()).toBe("2026-06-12T05:00:00.000Z");
    expect(cw.turnTime).toBeNull();
  });
});

describe("resolveCandidateWindow — refuses rather than guessing", () => {
  it("refuses when OPS_COMPLETED is missing", () => {
    const noEnd = events().filter((e) => e.semantic !== "OPS_COMPLETED");
    try {
      resolveCandidateWindow(noEnd, "NOR_ACCEPTED", null, null);
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("WINDOW_END_EVENT_MISSING");
    }
  });

  it("refuses when operations complete before laytime begins", () => {
    // OPS_COMPLETED before the commencement event.
    const bad = events({ OPS_COMPLETED: "2026-06-11T00:00:00Z" });
    try {
      resolveCandidateWindow(bad, "NOR_ACCEPTED", null, null);
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("WINDOW_EMPTY");
    }
  });

  it("refuses when the no-turn-time commencement event is missing", () => {
    const noAccept = events().filter((e) => e.semantic !== "NOR_ACCEPTED");
    try {
      resolveCandidateWindow(noAccept, "NOR_ACCEPTED", null, null);
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("COMMENCEMENT_EVENT_MISSING");
    }
  });
});

describe("calculateFromEvents — end to end", () => {
  it("derives the window and produces a balance", () => {
    // Window: NOR_ACCEPTED 05:00Z + 24h turn time = 2026-06-13T05:00Z start,
    // OPS_COMPLETED 2026-06-15T05:00Z end. ~2 days countable.
    const day0 = localMidnightOf(D("2026-06-13T09:00:00Z"), CAIRO);
    const r = calculateFromEvents({
      events: events(),
      commencementRule: "NOR_ACCEPTED",
      turnTimeHours: 24,
      turnTimeTrigger: "NOR_ACCEPTED",
      timeZone: CAIRO,
      excludedWeekdays: [],
      holidayDates: new Set<string>(),
      weatherApplies: false,
      eiuApplies: true,
      stoppageRules: new Map<string, StoppageCountability>(),
      allowedSeconds: 10 * 86400,
      stoppages: [],
      weatherEvents: [],
      didWorkOccur: () => false,
    });
    expect(r.window.start.toISOString()).toBe("2026-06-13T05:00:00.000Z");
    expect(r.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    // Nothing excluded → used = full window span.
    const spanSeconds = (r.window.end.getTime() - r.window.start.getTime()) / 1000;
    expect(r.balance.usedSeconds).toBe(spanSeconds);
    expect(r.balance.outcome).toBe("SAVED");
    void day0;
  });

  it("refuses the whole calculation when a required event is missing", () => {
    try {
      calculateFromEvents({
        events: events().filter((e) => e.semantic !== "OPS_COMPLETED"),
        commencementRule: "NOR_ACCEPTED",
        turnTimeHours: null,
        turnTimeTrigger: null,
        timeZone: CAIRO,
        excludedWeekdays: [],
        holidayDates: new Set<string>(),
        weatherApplies: false,
        eiuApplies: true,
        stoppageRules: new Map<string, StoppageCountability>(),
        allowedSeconds: 86400,
        stoppages: [],
        weatherEvents: [],
        didWorkOccur: () => false,
      });
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
    }
  });
});
