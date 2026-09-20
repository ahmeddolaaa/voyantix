"use server";

import { db } from "@/db/client";
import {
  laytimeCalculations,
  laytimeIntervals,
  laytimeIntervalStoppageLinks,
} from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";
import { loadPortCallCalcData, type RawStoppage } from "./_calc-loader";
import { computePortCall, type PortCallCalcData } from "@/lib/laytime/service/compute";
import { CalculationRefused } from "@/lib/laytime/refuse";
import { ENGINE_VERSION } from "@/lib/laytime/version";

/**
 * LAYTIME CALCULATION PERSISTENCE — Phase 7.
 *
 * recalculatePortCall runs the engine and PERSISTS the result as the port
 * call's single current calculation. Recalculation DELETES the prior
 * calculation (cascading its intervals and stoppage links) and rewrites the
 * new one inside ONE transaction, so a port call always carries exactly one
 * coherent calculation — never a half-replaced one.
 *
 * A refusal is persisted too (status 'refused', no intervals), except when the
 * port call has no resolved term: there is then no term to anchor a
 * calculation row to, so the refusal is returned without persistence.
 *
 * LaytimeInterval is the single source of calculation truth (F19); the time
 * sheet is read back as a query over intervals, never a separate table.
 */

function resolvedRulesSnapshot(
  data: PortCallCalcData,
  allowedSeconds: number | null
): Record<string, unknown> {
  return {
    engineVersion: ENGINE_VERSION,
    timeZone: data.timeZone,
    allowance: data.term.allowance,
    allowanceUnit: data.term.allowanceUnit,
    allowedSeconds,
    commencementRule: data.term.commencementRule,
    turnTimeHours: data.term.turnTimeHours,
    turnTimeTrigger: data.term.turnTimeTrigger,
    excludedWeekdays: data.version.excludedWeekdays,
    eiuApplies: data.version.eiuApplies,
    weatherApplies: data.version.weatherApplies,
    holidayDates: data.holidayDates,
    stoppageRules: Object.fromEntries(
      data.stoppageRules.map((r) => [r.stoppageReasonId, r.countability])
    ),
  };
}

/** Finds the stoppage whose effective span contains the interval, or null. */
function containingStoppage(
  interval: { start: Date; end: Date },
  rawStoppages: RawStoppage[],
  windowEnd: Date
): RawStoppage | null {
  for (const s of rawStoppages) {
    const effEnd = (s.end ?? windowEnd).getTime();
    if (
      s.start.getTime() <= interval.start.getTime() &&
      interval.end.getTime() <= effEnd
    ) {
      return s;
    }
  }
  return null;
}

export type RecalculateResult = {
  calculationId: string;
  status: "calculated" | "refused";
  refusalCode: string | null;
  usedSeconds: number | null;
  balanceSeconds: number | null;
  outcome: "SAVED" | "EXCEEDED" | "EXACT" | null;
  intervalCount: number;
  /** True unless the port call has no resolved term (nothing to persist). */
  persisted: boolean;
};

export async function recalculatePortCall(
  portCallId: string
): Promise<ActionResult<RecalculateResult>> {
  try {
    return await authorized<ActionResult<RecalculateResult>>(
      "statement.recalculate",
      async (ctx) => {
        const loaded = await loadPortCallCalcData(ctx, portCallId);
        if (loaded.kind === "notfound") {
          return fail<RecalculateResult>("NOT_FOUND", "Port call not found.");
        }
        if (loaded.kind === "no_term") {
          // No term → no row to anchor a calculation to. Return unpersisted.
          return ok<RecalculateResult>({
            calculationId: "",
            status: "refused",
            refusalCode: "PORT_CALL_TERM_UNRESOLVED",
            usedSeconds: null,
            balanceSeconds: null,
            outcome: null,
            intervalCount: 0,
            persisted: false,
          });
        }

        const { data, termId, ruleSetVersionId, rawStoppages } = loaded;

        // Run the engine, capturing a refusal as a persistable outcome.
        let computed: ReturnType<typeof computePortCall> | null = null;
        let refusal: CalculationRefused | null = null;
        try {
          computed = computePortCall(data);
        } catch (e) {
          if (e instanceof CalculationRefused) refusal = e;
          else throw e;
        }

        const allowedSeconds = computed ? computed.allowedSeconds : null;
        const snapshot = resolvedRulesSnapshot(data, allowedSeconds);

        const result = await db.transaction(async (tx) => {
          // Replace any prior calculation (cascades intervals + links).
          await tx
            .delete(laytimeCalculations)
            .where(
              and(
                eq(laytimeCalculations.portCallId, portCallId),
                eq(laytimeCalculations.organizationId, ctx.organizationId)
              )
            );

          if (refusal) {
            const [calc] = await tx
              .insert(laytimeCalculations)
              .values({
                organizationId: ctx.organizationId,
                portCallId,
                termId,
                ruleSetVersionId,
                status: "refused",
                refusalCode: refusal.code,
                refusalReason: refusal.message,
                resolvedRulesJson: snapshot,
                engineVersion: ENGINE_VERSION,
                calculatedByUserId: ctx.userId,
              })
              .returning({ id: laytimeCalculations.id });
            return {
              calculationId: calc.id,
              status: "refused" as const,
              refusalCode: refusal.code,
              usedSeconds: null,
              balanceSeconds: null,
              outcome: null as RecalculateResult["outcome"],
              intervalCount: 0,
            };
          }

          const c = computed!;
          const [calc] = await tx
            .insert(laytimeCalculations)
            .values({
              organizationId: ctx.organizationId,
              portCallId,
              termId,
              ruleSetVersionId,
              status: "calculated",
              windowStart: c.window.start,
              windowEnd: c.window.end,
              commencementAt: c.commencementAt,
              turnTimeStart: c.turnTime ? c.turnTime.interval.start : null,
              turnTimeEnd: c.turnTime ? c.turnTime.interval.end : null,
              allowedSeconds: String(c.allowedSeconds),
              usedSeconds: String(c.balance.usedSeconds),
              balanceSeconds: String(c.balance.balanceSeconds),
              outcome: c.balance.outcome,
              resolvedRulesJson: snapshot,
              engineVersion: ENGINE_VERSION,
              calculatedByUserId: ctx.userId,
            })
            .returning({ id: laytimeCalculations.id });

          const intervalRows = c.intervals.map((iv, i) => ({
            organizationId: ctx.organizationId,
            calculationId: calc.id,
            portCallId,
            sequence: i,
            startTime: iv.start,
            endTime: iv.end,
            treatment: iv.treatment,
            reasons: iv.reasons,
          }));
          const inserted = intervalRows.length
            ? await tx
                .insert(laytimeIntervals)
                .values(intervalRows)
                .returning({
                  id: laytimeIntervals.id,
                  startTime: laytimeIntervals.startTime,
                  endTime: laytimeIntervals.endTime,
                  treatment: laytimeIntervals.treatment,
                  reasons: laytimeIntervals.reasons,
                })
            : [];

          // Trace each stoppage-excluded interval to the stoppage that caused it.
          const links: {
            organizationId: string;
            intervalId: string;
            stoppageId: string;
          }[] = [];
          for (const row of inserted) {
            if (
              row.treatment === "EXCLUDED" &&
              row.reasons.includes("STOPPAGE_EXCLUDED")
            ) {
              const s = containingStoppage(
                { start: row.startTime, end: row.endTime },
                rawStoppages,
                c.window.end
              );
              if (s) {
                links.push({
                  organizationId: ctx.organizationId,
                  intervalId: row.id,
                  stoppageId: s.id,
                });
              }
            }
          }
          if (links.length) {
            await tx.insert(laytimeIntervalStoppageLinks).values(links);
          }

          return {
            calculationId: calc.id,
            status: "calculated" as const,
            refusalCode: null as string | null,
            usedSeconds: c.balance.usedSeconds,
            balanceSeconds: c.balance.balanceSeconds,
            outcome: c.balance.outcome as RecalculateResult["outcome"],
            intervalCount: inserted.length,
          };
        });

        await recordAudit(ctx, {
          entityType: "LaytimeCalculation",
          entityId: result.calculationId,
          action: "recalculate",
          after: { status: result.status, refusalCode: result.refusalCode },
        });

        return ok<RecalculateResult>({ ...result, persisted: true });
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<RecalculateResult>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}

// --- read back the persisted calculation + its time sheet (F19) ------------

export type PersistedInterval = {
  sequence: number;
  start: Date;
  end: Date;
  treatment: "COUNTED" | "EXCLUDED";
  reasons: string[];
};

export type PersistedCalculation = {
  id: string;
  status: "calculated" | "refused";
  refusalCode: string | null;
  refusalReason: string | null;
  window: { start: Date; end: Date } | null;
  allowedSeconds: number | null;
  usedSeconds: number | null;
  balanceSeconds: number | null;
  outcome: "SAVED" | "EXCEEDED" | "EXACT" | null;
  engineVersion: string;
  calculatedAt: Date;
  intervals: PersistedInterval[];
};

export async function getPortCallCalculation(
  portCallId: string
): Promise<ActionResult<PersistedCalculation | null>> {
  try {
    return await authorized<ActionResult<PersistedCalculation | null>>(
      "statement.read",
      async (ctx) => {
        const [calc] = await db
          .select()
          .from(laytimeCalculations)
          .where(
            and(
              eq(laytimeCalculations.portCallId, portCallId),
              eq(laytimeCalculations.organizationId, ctx.organizationId)
            )
          );
        if (!calc) return ok<PersistedCalculation | null>(null);

        const intervalRows = await db
          .select({
            sequence: laytimeIntervals.sequence,
            start: laytimeIntervals.startTime,
            end: laytimeIntervals.endTime,
            treatment: laytimeIntervals.treatment,
            reasons: laytimeIntervals.reasons,
          })
          .from(laytimeIntervals)
          .where(
            and(
              eq(laytimeIntervals.calculationId, calc.id),
              eq(laytimeIntervals.organizationId, ctx.organizationId)
            )
          )
          .orderBy(asc(laytimeIntervals.sequence));

        const num = (v: string | null): number | null =>
          v === null ? null : Number(v);

        return ok<PersistedCalculation | null>({
          id: calc.id,
          status: calc.status,
          refusalCode: calc.refusalCode,
          refusalReason: calc.refusalReason,
          window:
            calc.windowStart && calc.windowEnd
              ? { start: calc.windowStart, end: calc.windowEnd }
              : null,
          allowedSeconds: num(calc.allowedSeconds),
          usedSeconds: num(calc.usedSeconds),
          balanceSeconds: num(calc.balanceSeconds),
          outcome: calc.outcome,
          engineVersion: calc.engineVersion,
          calculatedAt: calc.calculatedAt,
          intervals: intervalRows.map((r) => ({
            sequence: r.sequence,
            start: r.start,
            end: r.end,
            treatment: r.treatment,
            reasons: r.reasons,
          })),
        });
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<PersistedCalculation | null>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}
