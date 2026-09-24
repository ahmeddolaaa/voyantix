"use server";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  voyagePortCalls,
  ports,
  laytimeCalculations,
  laytimeIntervals,
  laytimeIntervalStoppageLinks,
  stoppages,
  stoppageReasons,
  contractLaytimeTerms,
  contracts,
  laytimeRuleSets,
  laytimeRuleSetVersions,
  operationalEvents,
  operationalEventTypes,
  cargoPlans,
  cargoes,
} from "@/db/schema";
import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";
import { loadSettlementDayPrecision } from "./_settlement-precision";
import { settleBalance, type SettlementDayPrecision } from "@/lib/laytime/settlement";
import { CalculationRefused } from "@/lib/laytime/refuse";
import { sheetComment } from "@/lib/laytime/sheet-comments";
import {
  COMMENCEMENT_EVENTS,
  COMMENCEMENT_TIME_RULES,
  LAYTIME_END_EVENTS,
  DESPATCH_BASES,
  labelOf,
} from "@/lib/laytime/term-vocabulary";

/**
 * PORT CALL SHEET — everything the detailed laytime sheet of one port call
 * shows (modelled on Adel's MY FELLAS calculation): header, the events, the
 * terms in words, the time-sheet with comments, and the totals/settlement.
 * Read-only; every figure comes from the PERSISTED calculation and records —
 * nothing is recalculated here.
 */

export type SheetEvent = { label: string; semantic: string | null; at: Date };

export type SheetRow = {
  start: Date;
  end: Date;
  /** Counted seconds for the row (elapsed × counted fraction). */
  countedSeconds: number;
  comment: string;
  counted: boolean;
};

export type PortCallSheet = {
  calculationId: string;
  portName: string;
  operation: "LOAD" | "DISCHARGE";
  timeZone: string;
  contractReference: string | null;
  contractDate: string | null;
  cargo: string;
  terms: {
    allowance: string;
    ruleSet: string;
    commencement: string;
    laytimeEnds: string;
    onceOnDemurrage: boolean;
    demurrageRate: number;
    despatch: string | null;
  };
  events: SheetEvent[];
  commencementAt: Date;
  windowEnd: Date;
  allowedSeconds: number;
  usedSeconds: number;
  balanceSeconds: number;
  outcome: "SAVED" | "EXCEEDED" | "EXACT";
  rows: SheetRow[];
  settlement:
    | { kind: "demurrage" | "despatch"; days: number; rate: number; amount: number }
    | { kind: "none" }
    | { kind: "refused"; reason: string };
  dayPrecision: SettlementDayPrecision;
};

function fmtNumber(n: number, maxFractionDigits = 3): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: maxFractionDigits });
}

export async function getPortCallSheet(
  portCallId: string
): Promise<ActionResult<PortCallSheet | null>> {
  try {
    return await authorized<ActionResult<PortCallSheet | null>>("statement.read", async (ctx) => {
      const org = ctx.organizationId;

      const [pc] = await db
        .select({
          portName: ports.name,
          operation: voyagePortCalls.function,
          timeZone: voyagePortCalls.effectiveTimezone,
          laytimeEndOverride: voyagePortCalls.laytimeEndOverride,
        })
        .from(voyagePortCalls)
        .innerJoin(ports, and(eq(ports.id, voyagePortCalls.portId), eq(ports.organizationId, org)))
        .where(and(eq(voyagePortCalls.id, portCallId), eq(voyagePortCalls.organizationId, org)));
      if (!pc) return fail<PortCallSheet | null>("NOT_FOUND", "Port call not found.");

      const [calc] = await db
        .select()
        .from(laytimeCalculations)
        .where(and(eq(laytimeCalculations.portCallId, portCallId), eq(laytimeCalculations.organizationId, org)));
      if (!calc || calc.status !== "calculated" || !calc.windowStart || !calc.windowEnd || !calc.outcome) {
        return ok<PortCallSheet | null>(null);
      }

      const [term] = await db
        .select()
        .from(contractLaytimeTerms)
        .where(and(eq(contractLaytimeTerms.id, calc.termId), eq(contractLaytimeTerms.organizationId, org)));
      if (!term) return ok<PortCallSheet | null>(null);

      const [contract] = await db
        .select({ reference: contracts.reference, contractDate: contracts.contractDate })
        .from(contracts)
        .where(and(eq(contracts.id, term.contractId), eq(contracts.organizationId, org)));

      const [version] = await db
        .select({
          name: laytimeRuleSets.name,
          versionNumber: laytimeRuleSetVersions.versionNumber,
        })
        .from(laytimeRuleSetVersions)
        .innerJoin(laytimeRuleSets, eq(laytimeRuleSets.id, laytimeRuleSetVersions.ruleSetId))
        .where(and(eq(laytimeRuleSetVersions.id, calc.ruleSetVersionId), eq(laytimeRuleSetVersions.organizationId, org)));

      const eventRows = await db
        .select({ label: operationalEventTypes.label, semantic: operationalEventTypes.systemSemantic, at: operationalEvents.occurredAt })
        .from(operationalEvents)
        .innerJoin(operationalEventTypes, eq(operationalEventTypes.id, operationalEvents.eventTypeId))
        .where(
          and(
            eq(operationalEvents.portCallId, portCallId),
            eq(operationalEvents.organizationId, org),
            isNull(operationalEvents.supersededByEventId)
          )
        )
        .orderBy(asc(operationalEvents.occurredAt));

      const cargoRows = await db
        .select({ name: cargoes.name, planned: cargoPlans.plannedQuantityMt, actual: cargoPlans.actualQuantityMt })
        .from(cargoPlans)
        .innerJoin(cargoes, eq(cargoes.id, cargoPlans.cargoId))
        .where(and(eq(cargoPlans.portCallId, portCallId), eq(cargoPlans.organizationId, org)));

      const intervalRows = await db
        .select({
          id: laytimeIntervals.id,
          start: laytimeIntervals.startTime,
          end: laytimeIntervals.endTime,
          treatment: laytimeIntervals.treatment,
          countedFraction: laytimeIntervals.countedFraction,
          reasons: laytimeIntervals.reasons,
        })
        .from(laytimeIntervals)
        .where(and(eq(laytimeIntervals.calculationId, calc.id), eq(laytimeIntervals.organizationId, org)))
        .orderBy(asc(laytimeIntervals.sequence));

      const ids = intervalRows.map((r) => r.id);
      const links = ids.length
        ? await db
            .select({ intervalId: laytimeIntervalStoppageLinks.intervalId, name: stoppageReasons.name })
            .from(laytimeIntervalStoppageLinks)
            .innerJoin(stoppages, eq(stoppages.id, laytimeIntervalStoppageLinks.stoppageId))
            .innerJoin(stoppageReasons, eq(stoppageReasons.id, stoppages.reasonId))
            .where(and(inArray(laytimeIntervalStoppageLinks.intervalId, ids), eq(laytimeIntervalStoppageLinks.organizationId, org)))
        : [];
      const namesByInterval = new Map<string, string[]>();
      for (const l of links) namesByInterval.set(l.intervalId, [...(namesByInterval.get(l.intervalId) ?? []), l.name]);

      const rows: SheetRow[] = intervalRows.map((iv, i) => {
        const fraction = Number(iv.countedFraction);
        const elapsed = (iv.end.getTime() - iv.start.getTime()) / 1000;
        return {
          start: iv.start,
          end: iv.end,
          countedSeconds: elapsed * fraction,
          counted: fraction > 0,
          comment: sheetComment({
            reasons: iv.reasons,
            treatment: iv.treatment,
            countedFraction: fraction,
            stoppageNames: namesByInterval.get(iv.id),
            isFirst: i === 0,
          }),
        };
      });

      // Terms in words.
      const allowance =
        term.allowanceBasis === "RATE"
          ? `${fmtNumber(Number(term.allowanceRate))} MT per day`
          : `${fmtNumber(Number(term.allowance))} ${term.allowanceUnit}`;
      const ruleSet = version ? `${version.name} (v${version.versionNumber})` : "—";
      const basis = labelOf(COMMENCEMENT_EVENTS, term.commencementRule) ?? term.commencementRule;
      let commencement = `From ${basis}`;
      if (term.commencementTimeRule !== "AT_EVENT") {
        commencement += ` · ${labelOf(COMMENCEMENT_TIME_RULES, term.commencementTimeRule) ?? term.commencementTimeRule}`;
      } else if (term.turnTimeHours) {
        const trig = labelOf(COMMENCEMENT_EVENTS, term.turnTimeTrigger) ?? term.turnTimeTrigger;
        commencement = `${fmtNumber(Number(term.turnTimeHours))} h turn time from ${trig}, then counting`;
      }
      const endEvent = pc.laytimeEndOverride ?? term.laytimeEndEvent;
      const laytimeEnds = labelOf(LAYTIME_END_EVENTS, endEvent) ?? endEvent;
      const despatch =
        term.despatchRate === null
          ? null
          : `${fmtNumber(Number(term.despatchRate), 2)} per day${
              term.despatchBasis ? ` · ${labelOf(DESPATCH_BASES, term.despatchBasis) ?? term.despatchBasis}` : ""
            }`;

      const cargo = cargoRows.length
        ? cargoRows
            .map((c) =>
              c.actual !== null
                ? `${fmtNumber(Number(c.actual))} MT ${c.name}`
                : `${fmtNumber(Number(c.planned))} MT ${c.name} (planned)`
            )
            .join(" + ")
        : "—";

      const allowedSeconds = Number(calc.allowedSeconds);
      const usedSeconds = Number(calc.usedSeconds);
      const balanceSeconds = Number(calc.balanceSeconds);
      const dayPrecision = await loadSettlementDayPrecision(org);

      let settlement: PortCallSheet["settlement"];
      try {
        const s = settleBalance({
          outcome: calc.outcome,
          balanceSeconds,
          demurrageRate: Number(term.demurrageRate),
          despatchRate: term.despatchRate === null ? null : Number(term.despatchRate),
          despatchBasis: term.despatchBasis,
          dayPrecision,
        });
        settlement =
          s.kind === "none" ? { kind: "none" } : { kind: s.kind, days: s.days, rate: s.rate, amount: s.amount };
      } catch (e) {
        if (e instanceof CalculationRefused) settlement = { kind: "refused", reason: e.message };
        else throw e;
      }

      return ok<PortCallSheet | null>({
        calculationId: calc.id,
        portName: pc.portName,
        operation: pc.operation,
        timeZone: pc.timeZone,
        contractReference: contract?.reference ?? null,
        contractDate: contract?.contractDate ?? null,
        cargo,
        terms: {
          allowance,
          ruleSet,
          commencement,
          laytimeEnds,
          onceOnDemurrage: term.onceOnDemurrage,
          demurrageRate: Number(term.demurrageRate),
          despatch,
        },
        events: eventRows.map((e) => ({ label: e.label, semantic: e.semantic, at: e.at })),
        commencementAt: calc.windowStart,
        windowEnd: calc.windowEnd,
        allowedSeconds,
        usedSeconds,
        balanceSeconds,
        outcome: calc.outcome,
        rows,
        settlement,
        dayPrecision,
      });
    });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<PortCallSheet | null>("FORBIDDEN", "You do not have permission to perform this action.");
    }
    throw e;
  }
}
