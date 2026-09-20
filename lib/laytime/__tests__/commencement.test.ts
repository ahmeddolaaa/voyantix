import { describe, it, expect } from "vitest";
import {
  determineCommencement,
  resolveRequiredEvent,
  isEngineEventSemantic,
  type EngineEvent,
} from "../commencement";
import { CalculationRefused } from "../refuse";

const D = (iso: string) => new Date(iso);

const events: EngineEvent[] = [
  { semantic: "NOR_TENDERED", occurredAt: D("2026-06-14T05:00:00Z") },
  { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-14T08:00:00Z") },
  { semantic: "BERTHED", occurredAt: D("2026-06-14T12:00:00Z") },
];

describe("isEngineEventSemantic", () => {
  it("accepts the eight frozen semantics", () => {
    for (const s of [
      "NOR_TENDERED", "NOR_ACCEPTED", "BERTHED", "OPS_COMMENCED",
      "OPS_COMPLETED", "DEPARTED", "WEATHER_START", "WEATHER_END",
    ]) {
      expect(isEngineEventSemantic(s)).toBe(true);
    }
  });

  it("rejects anything else, including free-text descriptions", () => {
    expect(isEngineEventSemantic("NOR acceptance")).toBe(false);
    expect(isEngineEventSemantic("")).toBe(false);
    expect(isEngineEventSemantic("SHEX")).toBe(false);
  });
});

describe("determineCommencement — happy path", () => {
  it("commences at the configured basis event's instant", () => {
    const at = determineCommencement(events, "NOR_ACCEPTED");
    expect(at.toISOString()).toBe("2026-06-14T08:00:00.000Z");
  });

  it("uses whichever basis the contract configures (no hardcoded NOR)", () => {
    // A different contract commences at berthing.
    const at = determineCommencement(events, "BERTHED");
    expect(at.toISOString()).toBe("2026-06-14T12:00:00.000Z");
  });
});

describe("determineCommencement — refuses rather than guessing", () => {
  it("refuses an unrecognised basis instead of interpreting free text", () => {
    try {
      determineCommencement(events, "NOR acceptance");
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("COMMENCEMENT_BASIS_UNRECOGNISED");
    }
  });

  it("refuses when the configured basis event is missing (no fallback)", () => {
    // Basis is OPS_COMMENCED, but no such event exists. Must NOT fall back
    // to NOR_TENDERED or anything else.
    try {
      determineCommencement(events, "OPS_COMMENCED");
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("COMMENCEMENT_EVENT_MISSING");
    }
  });

  it("refuses when more than one live basis event exists", () => {
    const twoBerths: EngineEvent[] = [
      { semantic: "BERTHED", occurredAt: D("2026-06-14T12:00:00Z") },
      { semantic: "BERTHED", occurredAt: D("2026-06-15T09:00:00Z") },
    ];
    try {
      determineCommencement(twoBerths, "BERTHED");
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("COMMENCEMENT_EVENT_AMBIGUOUS");
    }
  });
});

describe("resolveRequiredEvent — context-tagged refusals", () => {
  it("returns the single matching instant", () => {
    const at = resolveRequiredEvent(events, "NOR_TENDERED", "TURN_TIME");
    expect(at.toISOString()).toBe("2026-06-14T05:00:00.000Z");
  });

  it("prefixes the refusal code with the caller's context", () => {
    try {
      resolveRequiredEvent(events, "DEPARTED", "TURN_TIME");
      throw new Error("should have refused");
    } catch (e) {
      expect((e as CalculationRefused).code).toBe("TURN_TIME_EVENT_MISSING");
    }
  });
});
