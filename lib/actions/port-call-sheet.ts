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
import { getLocalParts } from "@/lib/laytime/timezone";
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
    /** The C/P wording, when the term records it. */
    clauseText: string | null;
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

      // Rows are the persisted intervals; for READING only, a row that spans
      // the berthing is shown as two lines (waiting for berth / at berth), as
      // laytime sheets do. Counted time is split in proportion; totals unchanged.
      const berths = eventRows.filter((e) => e.semantic === "BERTHED");
      const berthedAt = berths.length === 1 ? berths[0].at.getTime() : null;
      type Piece = SheetRow & { day: string; merge: "DEMURRAGE" | "DEMURRAGE_EXCEPTED" | null; beforeBerth?: boolean };
      const dayOf = (d: Date) => {
        const p = getLocalParts(d, pc.timeZone);
        return `${p.year}-${p.month}-${p.day}`;
      };
      const pieces: Piece[] = [];
      intervalRows.forEach((iv, i) => {
        const fraction = Number(iv.countedFraction);
        const s0 = iv.start.getTime();
        const e0 = iv.end.getTime();
        const spans: Array<[number, number]> =
          berthedAt !== null && berthedAt > s0 && berthedAt < e0
            ? [[s0, berthedAt], [berthedAt, e0]]
            : [[s0, e0]];
        const onDemurrageCounted = fraction >= 1 && iv.reasons.includes("ON_DEMURRAGE");
        const excepted = iv.reasons.includes("EXCLUDED_WEEKDAY") || iv.reasons.includes("HOLIDAY");
        spans.forEach(([a, b], k) => {
          const beforeBerth = berthedAt === null ? undefined : b <= berthedAt;
          pieces.push({
            start: new Date(a),
            end: new Date(b),
            countedSeconds: ((b - a) / 1000) * fraction,
            counted: fraction > 0,
            day: dayOf(new Date(a)),
            beforeBerth,
            merge: onDemurrageCounted ? (excepted ? "DEMURRAGE_EXCEPTED" : "DEMURRAGE") : null,
            comment: sheetComment({
              reasons: iv.reasons,
              treatment: iv.treatment,
              countedFraction: fraction,
              stoppageNames: namesByInterval.get(iv.id),
              isFirst: i === 0 && k === 0,
              beforeBerth,
            }),
          });
        });
      });

      // Once on demurrage every counted minute is simply "on demurrage", so
      // (like the sheets) consecutive counted rows of the same day and the
      // same side of the berthing read as ONE row. Rows that do not count
      // always stay on their own.
      const rows: SheetRow[] = [];
      let prev: Piece | null = null;
      for (const p of pieces) {
        if (
          prev &&
          prev.merge !== null &&
          p.merge !== null &&
          prev.day === p.day &&
          prev.beforeBerth === p.beforeBerth &&
          prev.end.getTime() === p.start.getTime()
        ) {
          prev.end = p.end;
          prev.countedSeconds += p.countedSeconds;
          if (p.merge === "DEMURRAGE_EXCEPTED") prev.merge = "DEMURRAGE_EXCEPTED";
          prev.comment =
            prev.merge === "DEMURRAGE_EXCEPTED"
              ? "Time to count – excepted day, vessel is on demurrage"
              : "Time to count – vessel is on demurrage";
          continue;
        }
        const copy: Piece = { ...p };
        rows.push(copy);
        prev = copy;
      }
      // Hand back plain rows (the helper fields are internal).
      for (const r of rows as Piece[]) {
        delete (r as Partial<Piece>).day;
        delete (r as Partial<Piece>).merge;
        delete (r as Partial<Piece>).beforeBerth;
      }

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
          clauseText: term.laytimeClauseText,
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
