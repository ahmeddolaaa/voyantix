/**
 * PORT-CALL CALCULATION LOADER — the shared read that both the read-only
 * calculation and the persisting recalculation use. Not a server action (no
 * "use server"): it is an internal helper called inside an already-authorized
 * action, given that action's TenantContext.
 *
 * It returns the engine-ready PortCallCalcData plus provenance (term and
 * rule-set version ids) and the RAW stoppages (with their row ids) so the
 * persistence layer can link excluded intervals back to the stoppage that
 * caused them. All queries are tenant-scoped to ctx.organizationId.
 */

import { db } from "@/db/client";
import {
  voyagePortCalls,
  contractLaytimeTerms,
  laytimeRuleSetVersions,
  operationalEvents,
  operationalEventTypes,
  stoppages,
  contractStoppageRules,
  holidays,
  shiftPerformances,
  cargoPlans,
} from "@/db/schema";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { TenantContext } from "@/lib/auth/session";
import {
  type PortCallCalcData,
  type LoadedEvent,
  type LoadedStoppage,
  type LoadedStoppageRule,
} from "@/lib/laytime/service/compute";
import type { StoppageCountability } from "@/lib/laytime/classify";

export type RawStoppage = {
  id: string;
  start: Date;
  end: Date | null;
  reasonId: string;
};

export type LoadResult =
  | { kind: "notfound" }
  | { kind: "no_term" }
  | {
      kind: "loaded";
      timeZone: string;
      termId: string;
      ruleSetVersionId: string;
      data: PortCallCalcData;
      rawStoppages: RawStoppage[];
    };

export async function loadPortCallCalcData(
  ctx: TenantContext,
  portCallId: string
): Promise<LoadResult> {
  const [portCall] = await db
    .select({
      timeZone: voyagePortCalls.effectiveTimezone,
      termId: voyagePortCalls.contractLaytimeTermId,
      laytimeEndOverride: voyagePortCalls.laytimeEndOverride,
    })
    .from(voyagePortCalls)
    .where(
      and(
        eq(voyagePortCalls.id, portCallId),
        eq(voyagePortCalls.organizationId, ctx.organizationId)
      )
    );
  if (!portCall) return { kind: "notfound" };
  if (!portCall.termId) return { kind: "no_term" };

  const [term] = await db
    .select({
      allowanceBasis: contractLaytimeTerms.allowanceBasis,
      allowance: contractLaytimeTerms.allowance,
      allowanceUnit: contractLaytimeTerms.allowanceUnit,
      allowanceRate: contractLaytimeTerms.allowanceRate,
      commencementRule: contractLaytimeTerms.commencementRule,
      commencementTimeRule: contractLaytimeTerms.commencementTimeRule,
      turnTimeHours: contractLaytimeTerms.turnTimeHours,
      turnTimeTrigger: contractLaytimeTerms.turnTimeTrigger,
      onceOnDemurrage: contractLaytimeTerms.onceOnDemurrage,
      laytimeEndEvent: contractLaytimeTerms.laytimeEndEvent,
      ruleSetVersionId: contractLaytimeTerms.ruleSetVersionId,
    })
    .from(contractLaytimeTerms)
    .where(
      and(
        eq(contractLaytimeTerms.id, portCall.termId),
        eq(contractLaytimeTerms.organizationId, ctx.organizationId)
      )
    );
  if (!term) return { kind: "notfound" };

  const [version] = await db
    .select({
      excludedWeekdays: laytimeRuleSetVersions.excludedWeekdays,
      excludeHolidays: laytimeRuleSetVersions.excludeHolidays,
      eiuApplies: laytimeRuleSetVersions.eiuApplies,
      weatherApplies: laytimeRuleSetVersions.weatherApplies,
      holidayCalendarId: laytimeRuleSetVersions.holidayCalendarId,
    })
    .from(laytimeRuleSetVersions)
    .where(
      and(
        eq(laytimeRuleSetVersions.id, term.ruleSetVersionId),
        eq(laytimeRuleSetVersions.organizationId, ctx.organizationId)
      )
    );
  if (!version) return { kind: "notfound" };

  const eventRows = await db
    .select({
      semantic: operationalEventTypes.systemSemantic,
      occurredAt: operationalEvents.occurredAt,
    })
    .from(operationalEvents)
    .innerJoin(
      operationalEventTypes,
      and(
        eq(operationalEvents.eventTypeId, operationalEventTypes.id),
        eq(operationalEvents.organizationId, operationalEventTypes.organizationId)
      )
    )
    .where(
      and(
        eq(operationalEvents.portCallId, portCallId),
        eq(operationalEvents.organizationId, ctx.organizationId),
        isNull(operationalEvents.supersededByEventId)
      )
    )
    .orderBy(asc(operationalEvents.occurredAt));
  const events: LoadedEvent[] = eventRows.map((e) => ({
    semantic: e.semantic,
    occurredAt: e.occurredAt,
  }));

  const stoppageRows = await db
    .select({
      id: stoppages.id,
      start: stoppages.startTime,
      end: stoppages.endTime,
      reasonId: stoppages.reasonId,
    })
    .from(stoppages)
    .where(
      and(
        eq(stoppages.portCallId, portCallId),
        eq(stoppages.organizationId, ctx.organizationId)
      )
    )
    .orderBy(asc(stoppages.startTime));
  const rawStoppages: RawStoppage[] = stoppageRows.map((s) => ({
    id: s.id,
    start: s.start,
    end: s.end,
    reasonId: s.reasonId,
  }));
  const loadedStoppages: LoadedStoppage[] = rawStoppages.map((s) => ({
    start: s.start,
    end: s.end,
    reasonId: s.reasonId,
  }));

  const ruleRows = await db
    .select({
      stoppageReasonId: contractStoppageRules.stoppageReasonId,
      countability: contractStoppageRules.countability,
      excludedOnDemurrage: contractStoppageRules.excludedOnDemurrage,
    })
    .from(contractStoppageRules)
    .where(
      and(
        eq(contractStoppageRules.termId, portCall.termId),
        eq(contractStoppageRules.organizationId, ctx.organizationId)
      )
    );
  const stoppageRules: LoadedStoppageRule[] = ruleRows.map((r) => ({
    stoppageReasonId: r.stoppageReasonId,
    countability: r.countability as StoppageCountability,
    excludedOnDemurrage: r.excludedOnDemurrage,
  }));

  let holidayDates: string[] = [];
  if (version.excludeHolidays && version.holidayCalendarId) {
    const holidayRows = await db
      .select({ date: holidays.date })
      .from(holidays)
      .where(eq(holidays.holidayCalendarId, version.holidayCalendarId));
    holidayDates = holidayRows.map((h) => h.date);
  }

  const workedRows = await db
    .select({ shiftDate: shiftPerformances.shiftDate })
    .from(shiftPerformances)
    .where(
      and(
        eq(shiftPerformances.portCallId, portCallId),
        eq(shiftPerformances.organizationId, ctx.organizationId),
        gt(shiftPerformances.quantityMt, "0")
      )
    );
  const workedLocalDates = workedRows.map((w) => w.shiftDate);

  // Total ACTUAL cargo quantity on this port call (MT), for a rate-based
  // allowance. Only recorded actuals count; if none are recorded the total is
  // null and a rate-based term refuses rather than guessing from planned qty.
  const cargoRows = await db
    .select({
      plannedQuantityMt: cargoPlans.plannedQuantityMt,
      actualQuantityMt: cargoPlans.actualQuantityMt,
    })
    .from(cargoPlans)
    .where(
      and(
        eq(cargoPlans.portCallId, portCallId),
        eq(cargoPlans.organizationId, ctx.organizationId)
      )
    );
  const sumOf = (vals: (string | null)[]): string | null => {
    const nums = vals.filter((q): q is string => q != null && q.trim() !== "");
    return nums.length === 0
      ? null
      : String(nums.reduce((sum, q) => sum + Number(q), 0));
  };
  const actualQuantityMt = sumOf(cargoRows.map((r) => r.actualQuantityMt));
  const plannedQuantityMt = sumOf(cargoRows.map((r) => r.plannedQuantityMt));

  const data: PortCallCalcData = {
    timeZone: portCall.timeZone,
    term: {
      allowanceBasis: term.allowanceBasis,
      allowance: term.allowance,
      allowanceUnit: term.allowanceUnit,
      allowanceRate: term.allowanceRate,
      commencementRule: term.commencementRule,
      commencementTimeRule: term.commencementTimeRule,
      turnTimeHours: term.turnTimeHours,
      turnTimeTrigger: term.turnTimeTrigger,
      onceOnDemurrage: term.onceOnDemurrage,
      laytimeEndEvent: term.laytimeEndEvent,
    },
    version: {
      excludedWeekdays: version.excludedWeekdays,
      eiuApplies: version.eiuApplies,
      weatherApplies: version.weatherApplies,
    },
    events,
    stoppages: loadedStoppages,
    stoppageRules,
    holidayDates,
    workedLocalDates,
    actualQuantityMt,
    plannedQuantityMt,
    laytimeEndOverride: portCall.laytimeEndOverride,
  };

  return {
    kind: "loaded",
    timeZone: portCall.timeZone,
    termId: portCall.termId,
    ruleSetVersionId: term.ruleSetVersionId,
    data,
    rawStoppages,
  };
}
