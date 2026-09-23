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
import { resolveCandidateWindow, deriveCommencementStart } from "../window";
import { resolveTurnTime } from "../turn-time";
import { calculatePortCall } from "../pipeline";
import { type StoppageSpan } from "../event-tagging";
import { type WeatherEvent } from "../event-periods";
import {
  type StoppageCountability,
  type ClassifiedInterval,
} from "../classify";
import { type Balance } from "../accumulate";
import { type TurnTime } from "../turn-time";
import { allowanceToSeconds, allowedSecondsFromRate } from "../units";
import { CalculationRefused } from "../refuse";
import {
  type CommencementTimeRule,
  type CommencementCalendar,
} from "../commencement";
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
  /** Still interrupts time once on demurrage (OODAOD exception). */
  excludedOnDemurrage?: boolean;
};

function demurrageExceptions(rules: LoadedStoppageRule[]): Set<string> {
  return new Set(
    rules
      .filter((r) => r.excludedOnDemurrage === true && r.countability === "AlwaysExcluded")
      .map((r) => r.stoppageReasonId)
  );
}

export type LoadedRuleSetVersion = {
  excludedWeekdays: number[];
  eiuApplies: boolean;
  weatherApplies: boolean;
};

export type LoadedTerm = {
  /** "FIXED" | "RATE" — how the allowed laytime is obtained. */
  allowanceBasis: string;
  allowance: string;
  allowanceUnit: string;
  /** MT-per-day rate; used only when allowanceBasis = RATE. */
  allowanceRate: string | null;
  commencementRule: string;
  /** "AT_EVENT" | "MORNING_NOR_1400" (amended GENCON 6(c)) — see commencement.ts. */
  commencementTimeRule: string;
  turnTimeHours: string | null;
  turnTimeTrigger: string | null;
  /** "Once on demurrage, always on demurrage" clause. */
  onceOnDemurrage: boolean;
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
  /** Total actual cargo quantity (MT) for the port call; null if none recorded.
      Required only for a RATE-based allowance. */
  actualQuantityMt: string | null;
  /** Total PLANNED cargo quantity (MT); used for the provisional running view
      before actuals exist. Null if none planned. */
  plannedQuantityMt: string | null;
};

export type PortCallComputation = {
  balance: Balance;
  intervals: ClassifiedInterval[];
  window: { start: Date; end: Date };
  turnTime: TurnTime | null;
  commencementAt: Date;
  allowedSeconds: number;
};

/** The term's commencement time rule; anything unrecognised is refused. */
function commencementTimeRuleOf(term: LoadedTerm): CommencementTimeRule {
  const r = term.commencementTimeRule;
  if (r === "AT_EVENT" || r === "MORNING_NOR_1400") return r;
  throw new CalculationRefused(
    "COMMENCEMENT_TIME_RULE_UNRECOGNISED",
    `Cannot calculate: the commencement time rule "${r}" is not recognised.`
  );
}

/** The rule set's calendar, for a commencement rule that needs a "next working day". */
function calendarOf(data: PortCallCalcData): CommencementCalendar {
  return {
    excludedWeekdays: data.version.excludedWeekdays,
    holidayDates: new Set(data.holidayDates),
  };
}

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
    data.term.turnTimeTrigger,
    data.timeZone,
    commencementTimeRuleOf(data.term),
    undefined,
    calendarOf(data)
  );

  const stoppages: StoppageSpan[] = data.stoppages.map((s) => ({
    start: s.start,
    end: s.end ?? cw.window.end,
    reasonId: s.reasonId,
  }));

  const stoppageRules = new Map<string, StoppageCountability>(
    data.stoppageRules.map((r) => [r.stoppageReasonId, r.countability])
  );

  let allowedSeconds: number;
  if (data.term.allowanceBasis === "RATE") {
    if (data.term.allowanceRate == null) {
      throw new CalculationRefused(
        "ALLOWANCE_RATE_MISSING",
        "Cannot calculate: this term's allowance is rate-based but no rate is set."
      );
    }
    if (data.actualQuantityMt == null) {
      throw new CalculationRefused(
        "ALLOWANCE_QUANTITY_MISSING",
        "Cannot calculate: this term's allowance is rate-based, but no actual cargo quantity has been recorded for this port call."
      );
    }
    allowedSeconds = allowedSecondsFromRate(
      Number(data.actualQuantityMt),
      Number(data.term.allowanceRate)
    );
  } else {
    allowedSeconds = allowanceToSeconds(
      data.term.allowance,
      data.term.allowanceUnit
    );
  }

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
    onceOnDemurrage: data.term.onceOnDemurrage,
    demurrageExceptedReasonIds: demurrageExceptions(data.stoppageRules),
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

// --- PROVISIONAL RUNNING STATUS (reference, not settlement) ----------------

export type ProvisionalStatus = {
  /** Allowed laytime (seconds). Provisional when it comes from planned qty. */
  allowedSeconds: number;
  /** Counted laytime used up to `asOf`. */
  usedSeconds: number;
  /** allowedSeconds − usedSeconds; negative means already on demurrage. */
  remainingSeconds: number;
  onDemurrage: boolean;
  /** True when the allowance used actual cargo quantity; false = planned. */
  quantityIsActual: boolean;
  window: { start: Date; end: Date };
  asOf: Date;
};

/**
 * A provisional, reference-only laytime status for an operation still in
 * progress. It answers "how much laytime is left, and are we about to go on
 * demurrage?" day by day. It is NOT the settlement: the allowance uses PLANNED
 * cargo quantity until actuals exist, and counting runs to `asOf` (now) rather
 * than to OPS_COMPLETED. The same exclusion pipeline applies, so holidays and
 * recorded stoppages are already subtracted. When actual quantity and the
 * completion event exist, `computePortCall` is the authoritative figure.
 */
export function computeProvisionalStatus(
  data: PortCallCalcData,
  asOf: Date
): ProvisionalStatus {
  const { engineEvents, weatherEvents } = partitionEvents(data.events);

  const quantityIsActual = data.actualQuantityMt != null;
  const qty = data.actualQuantityMt ?? data.plannedQuantityMt;

  let allowedSeconds: number;
  if (data.term.allowanceBasis === "RATE") {
    if (data.term.allowanceRate == null) {
      throw new CalculationRefused(
        "ALLOWANCE_RATE_MISSING",
        "Cannot show status: this term's allowance is rate-based but no rate is set."
      );
    }
    if (qty == null) {
      throw new CalculationRefused(
        "ALLOWANCE_QUANTITY_MISSING",
        "Cannot show status: a rate-based allowance needs a planned or actual cargo quantity."
      );
    }
    allowedSeconds = allowedSecondsFromRate(
      Number(qty),
      Number(data.term.allowanceRate)
    );
  } else {
    allowedSeconds = allowanceToSeconds(
      data.term.allowance,
      data.term.allowanceUnit
    );
  }

  const turnTimeHours =
    data.term.turnTimeHours == null ? null : Number(data.term.turnTimeHours);
  const turnTime = resolveTurnTime(
    engineEvents,
    turnTimeHours,
    data.term.turnTimeTrigger
  );
  const start = deriveCommencementStart(
    engineEvents,
    data.term.commencementRule,
    turnTime,
    data.timeZone,
    commencementTimeRuleOf(data.term),
    calendarOf(data)
  );

  // Counting has not begun as of this instant: nothing used yet.
  if (asOf.getTime() <= start.getTime()) {
    return {
      allowedSeconds,
      usedSeconds: 0,
      remainingSeconds: allowedSeconds,
      onDemurrage: allowedSeconds <= 0,
      quantityIsActual,
      window: { start, end: start },
      asOf,
    };
  }

  const window = { start, end: asOf };
  const stoppages: StoppageSpan[] = data.stoppages.map((s) => ({
    start: s.start,
    end: s.end ?? window.end,
    reasonId: s.reasonId,
  }));
  const stoppageRules = new Map<string, StoppageCountability>(
    data.stoppageRules.map((r) => [r.stoppageReasonId, r.countability])
  );
  const workedSet = new Set(data.workedLocalDates);
  const didWorkOccur = (interval: ClassifiedInterval): boolean => {
    const p = getLocalParts(interval.start, data.timeZone);
    return workedSet.has(toLocalDateKey(p.year, p.month, p.day));
  };

  const result = calculatePortCall({
    window,
    timeZone: data.timeZone,
    excludedWeekdays: data.version.excludedWeekdays,
    holidayDates: new Set(data.holidayDates),
    weatherApplies: data.version.weatherApplies,
    eiuApplies: data.version.eiuApplies,
    stoppageRules,
    allowedSeconds,
    onceOnDemurrage: data.term.onceOnDemurrage,
    demurrageExceptedReasonIds: demurrageExceptions(data.stoppageRules),
    stoppages,
    weatherEvents,
    didWorkOccur,
  });

  const usedSeconds = result.balance.usedSeconds;
  const remainingSeconds = allowedSeconds - usedSeconds;
  return {
    allowedSeconds,
    usedSeconds,
    remainingSeconds,
    onDemurrage: remainingSeconds < 0,
    quantityIsActual,
    window,
    asOf,
  };
}
