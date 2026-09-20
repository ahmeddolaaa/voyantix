"use server";

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
} from "@/db/schema";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";
import {
  computePortCall,
  type PortCallCalcData,
  type LoadedEvent,
  type LoadedStoppage,
  type LoadedStoppageRule,
} from "@/lib/laytime/service/compute";
import { CalculationRefused } from "@/lib/laytime/refuse";
import type { ClassifiedInterval, StoppageCountability } from "@/lib/laytime/classify";

/**
 * CALCULATE PORT CALL — the Phase 7 bridge from stored records to a balance.
 *
 * This action LOADS a port call's data and runs the pure engine; it does not
 * yet persist anything (LaytimeCalculation / LaytimeInterval follow). It is a
 * `statement.recalculate` capability — a viewer can read a stored statement
 * but cannot run the engine.
 *
 * A REFUSAL is a first-class, expected RESULT of a calculation, not an error:
 * the engine's whole discipline is to refuse rather than guess when a
 * required event, rule, or unit is undefined. So a refusal is returned under
 * `ok: true` as `{ status: "refused", code, reason }`, carrying the engine's
 * own refusal code for the UI to explain. `ok: false` is reserved for access
 * and tenancy outcomes (NOT_FOUND, FORBIDDEN) — the calculation never ran.
 */

export type CalculatedTimesheetInterval = {
  start: Date;
  end: Date;
  treatment: ClassifiedInterval["treatment"];
  reasons: string[];
};

export type CalculationSuccess = {
  status: "calculated";
  window: { start: Date; end: Date };
  commencementAt: Date;
  turnTime: { start: Date; end: Date } | null;
  allowedSeconds: number;
  usedSeconds: number;
  balanceSeconds: number;
  outcome: "SAVED" | "EXCEEDED" | "EXACT";
  intervals: CalculatedTimesheetInterval[];
};

export type CalculationRefusal = {
  status: "refused";
  /** The engine's structured refusal code (e.g. WINDOW_END_EVENT_MISSING). */
  code: string;
  reason: string;
};

export type CalculationOutcome = CalculationSuccess | CalculationRefusal;

export async function calculatePortCall(
  portCallId: string
): Promise<ActionResult<CalculationOutcome>> {
  try {
    return await authorized<ActionResult<CalculationOutcome>>(
      "statement.recalculate",
      async (ctx) => {
        // 1. The port call — its timezone and resolved term.
        const [portCall] = await db
          .select({
            timeZone: voyagePortCalls.effectiveTimezone,
            termId: voyagePortCalls.contractLaytimeTermId,
          })
          .from(voyagePortCalls)
          .where(
            and(
              eq(voyagePortCalls.id, portCallId),
              eq(voyagePortCalls.organizationId, ctx.organizationId)
            )
          );
        if (!portCall) {
          return fail<CalculationOutcome>("NOT_FOUND", "Port call not found.");
        }
        if (!portCall.termId) {
          return ok<CalculationOutcome>({
            status: "refused",
            code: "PORT_CALL_TERM_UNRESOLVED",
            reason:
              "Cannot calculate: this port call has no laytime term resolved. Resolve or set a term before calculating.",
          });
        }

        // 2. The commercial term.
        const [term] = await db
          .select({
            allowance: contractLaytimeTerms.allowance,
            allowanceUnit: contractLaytimeTerms.allowanceUnit,
            commencementRule: contractLaytimeTerms.commencementRule,
            turnTimeHours: contractLaytimeTerms.turnTimeHours,
            turnTimeTrigger: contractLaytimeTerms.turnTimeTrigger,
            ruleSetVersionId: contractLaytimeTerms.ruleSetVersionId,
          })
          .from(contractLaytimeTerms)
          .where(
            and(
              eq(contractLaytimeTerms.id, portCall.termId),
              eq(contractLaytimeTerms.organizationId, ctx.organizationId)
            )
          );
        if (!term) {
          return fail<CalculationOutcome>("NOT_FOUND", "Laytime term not found.");
        }

        // 3. The immutable rule-set version (reusable semantics).
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
        if (!version) {
          return fail<CalculationOutcome>("NOT_FOUND", "Rule-set version not found.");
        }

        // 4. Live operational events (superseded ones excluded), with the
        //    engine semantic carried by their type (F8).
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

        // 5. Stoppages (open ones carry a null end; the engine closes them).
        const stoppageRows = await db
          .select({
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
        const loadedStoppages: LoadedStoppage[] = stoppageRows.map((s) => ({
          start: s.start,
          end: s.end,
          reasonId: s.reasonId,
        }));

        // 6. The term's stoppage countability rules.
        const ruleRows = await db
          .select({
            stoppageReasonId: contractStoppageRules.stoppageReasonId,
            countability: contractStoppageRules.countability,
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
        }));

        // 7. Holiday dates — only when this rule set excludes them.
        let holidayDates: string[] = [];
        if (version.excludeHolidays && version.holidayCalendarId) {
          const holidayRows = await db
            .select({ date: holidays.date })
            .from(holidays)
            .where(eq(holidays.holidayCalendarId, version.holidayCalendarId));
          holidayDates = holidayRows.map((h) => h.date);
        }

        // 8. Local operational days on which cargo actually moved (F24, EIU
        //    used-set). shiftDate is already the port-local operational day.
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

        const data: PortCallCalcData = {
          timeZone: portCall.timeZone,
          term: {
            allowance: term.allowance,
            allowanceUnit: term.allowanceUnit,
            commencementRule: term.commencementRule,
            turnTimeHours: term.turnTimeHours,
            turnTimeTrigger: term.turnTimeTrigger,
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
        };

        try {
          const c = computePortCall(data);
          return ok<CalculationOutcome>({
            status: "calculated",
            window: c.window,
            commencementAt: c.commencementAt,
            turnTime: c.turnTime
              ? { start: c.turnTime.interval.start, end: c.turnTime.interval.end }
              : null,
            allowedSeconds: c.allowedSeconds,
            usedSeconds: c.balance.usedSeconds,
            balanceSeconds: c.balance.balanceSeconds,
            outcome: c.balance.outcome,
            intervals: c.intervals.map((i) => ({
              start: i.start,
              end: i.end,
              treatment: i.treatment,
              reasons: i.reasons,
            })),
          });
        } catch (e) {
          if (e instanceof CalculationRefused) {
            return ok<CalculationOutcome>({
              status: "refused",
              code: e.code,
              reason: e.message,
            });
          }
          throw e;
        }
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<CalculationOutcome>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}
