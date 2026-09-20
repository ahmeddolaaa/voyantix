/**
 * PORT-CALL COMPUTE — the pure bridge from loaded records to a balance
 * (Phase 7). It maps already-loaded, DB-agnostic rows into the engine's
 * inputs and runs the calculation. It holds NO database access, NO tenant
 * logic and NO commercial decisions: every undefined semantic is still
 * decided (and refused) inside the engine. Its own only judgement is the
 * allowance-unit conversion, which itself refuses rather than guessing.
 *
 * Why this sits between the action layer and the engine:
 *   - open stoppages (null end) must be closed to a concrete end before
 *     tagging, and the end they close to is the countable window end — which
 *     is only known once the window is derived. So the window is derived
 *     first (resolveCandidateWindow), then stoppages are closed, then the
 *     pipeline runs. calculateFromEvents cannot be used directly because it
 *     takes already-closed stoppages.
 *   - events carry a nullable free semantic in the database; only the eight
 *     engine semantics may drive the engine (F8), and WEATHER_* are routed to
 *     the weather channel rather than the commencement/window channel.
 *   - "did work occur" (the EIU used-determination, relevant only when
 *     eiuApplies is false) is F24: work occurred on a local operational day
 *     iff a shift performance recorded cargo movement that day. Tonnage never
 *     moves the clock; the day-grain worked-set is all the engine may read.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import {
  isEngineEventSemantic,
  type EngineEvent,
} from "../commencement";
import { resolveCandidateWindow } from "../window";
import { calculatePortCall } from "../pipeline";
import { type StoppageSpan } from "../event-tagging";
import { type WeatherEvent } from "../event-periods";
import {
  type StoppageCountability,
  type ClassifiedInterval,
} from "../classify";
import { type Balance } from "../accumulate";
import { type TurnTime } from "../turn-time";
import { allowanceToSeconds } from "../units";
import { getLocalParts } from "../timezone";
import { toLocalDateKey } from "../calendar-classification";

// --- DB-agnostic loaded shapes (plain values only) -------------------------

export type LoadedEvent = {
  /** operationalEventType.systemSemantic; null/other = informational. */
  semantic: string | null;
  occurredAt: Date;
};

export type LoadedStoppage = {
  start: Date;
  /** null = still open; closed to the window end before tagging. */
  end: Date | null;
  reasonId: string;
};

export type LoadedStoppageRule = {
  stoppageReasonId: string;
  countability: StoppageCountability;
};

export type LoadedRuleSetVersion = {
  excludedWeekdays: number[];
  eiuApplies: boolean;
  weatherApplies: boolean;
};

export type LoadedTerm = {
  allowance: string;
  allowanceUnit: string;
  commencementRule: string;
  turnTimeHours: string | null;
  turnTimeTrigger: string | null;
};

export type PortCallCalcData = {
  timeZone: string;
  term: LoadedTerm;
  version: LoadedRuleSetVersion;
  events: LoadedEvent[];
  stoppages: LoadedStoppage[];
  stoppageRules: LoadedStoppageRule[];
  /** Local YYYY-MM-DD holiday dates (empty when holidays are not excluded). */
  holidayDates: string[];
  /** Local YYYY-MM-DD dates on which cargo moved (F24, EIU used-set). */
  workedLocalDates: string[];
};

export type PortCallComputation = {
  balance: Balance;
  intervals: ClassifiedInterval[];
  window: { start: Date; end: Date };
  turnTime: TurnTime | null;
  commencementAt: Date;
  allowedSeconds: number;
};

/** Splits loaded events into the engine's commencement/window and weather channels. */
function partitionEvents(events: LoadedEvent[]): {
  engineEvents: EngineEvent[];
  weatherEvents: WeatherEvent[];
} {
  const engineEvents: EngineEvent[] = [];
  const weatherEvents: WeatherEvent[] = [];
  for (const e of events) {
    if (e.semantic === null) continue; // no semantic recorded
    if (!isEngineEventSemantic(e.semantic)) continue; // informational
    if (e.semantic === "WEATHER_START" || e.semantic === "WEATHER_END") {
      weatherEvents.push({ semantic: e.semantic, occurredAt: e.occurredAt });
    } else {
      engineEvents.push({ semantic: e.semantic, occurredAt: e.occurredAt });
    }
  }
  return { engineEvents, weatherEvents };
}

export function computePortCall(data: PortCallCalcData): PortCallComputation {
  const { engineEvents, weatherEvents } = partitionEvents(data.events);

  const turnTimeHours =
    data.term.turnTimeHours == null ? null : Number(data.term.turnTimeHours);

  // Derive the window first so open stoppages can be closed to its end.
  const cw = resolveCandidateWindow(
    engineEvents,
    data.term.commencementRule,
    turnTimeHours,
    data.term.turnTimeTrigger
  );

  const stoppages: StoppageSpan[] = data.stoppages.map((s) => ({
    start: s.start,
    end: s.end ?? cw.window.end,
    reasonId: s.reasonId,
  }));

  const stoppageRules = new Map<string, StoppageCountability>(
    data.stoppageRules.map((r) => [r.stoppageReasonId, r.countability])
  );

  const allowedSeconds = allowanceToSeconds(
    data.term.allowance,
    data.term.allowanceUnit
  );

  const workedSet = new Set(data.workedLocalDates);
  const didWorkOccur = (interval: ClassifiedInterval): boolean => {
    // The interval's owning local operational day (F18/F28: local, not UTC).
    const p = getLocalParts(interval.start, data.timeZone);
    return workedSet.has(toLocalDateKey(p.year, p.month, p.day));
  };

  const result = calculatePortCall({
    window: cw.window,
    timeZone: data.timeZone,
    excludedWeekdays: data.version.excludedWeekdays,
    holidayDates: new Set(data.holidayDates),
    weatherApplies: data.version.weatherApplies,
    eiuApplies: data.version.eiuApplies,
    stoppageRules,
    allowedSeconds,
    stoppages,
    weatherEvents,
    didWorkOccur,
  });

  return {
    balance: result.balance,
    intervals: result.intervals,
    window: cw.window,
    turnTime: cw.turnTime,
    commencementAt: cw.commencementAt,
    allowedSeconds,
  };
}
