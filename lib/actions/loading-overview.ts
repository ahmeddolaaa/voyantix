"use server";

import { db } from "@/db/client";
import { voyagePortCalls, cargoPlans, cargoes, shiftPerformances } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";
import { loadPortCallCalcData } from "./_calc-loader";
import { computeProvisionalStatus } from "@/lib/laytime/service/compute";
import { CalculationRefused } from "@/lib/laytime/refuse";
import { forecastFinish, type Forecast } from "@/lib/laytime/forecast";
import { getLocalParts } from "@/lib/laytime/timezone";

/**
 * LOADING OVERVIEW — cargo progress for one port call (plan vs handled, by
 * cargo and by crane, today's tonnage, stoppages while working) and the
 * finish forecast. Read-only. The forecast is an estimate and never feeds a
 * calculation, statement or claim.
 */

export type LoadingOverview = {
  fn: "LOAD" | "DISCHARGE";
  timeZone: string;
  plannedMt: number;
  handledMt: number;
  todayMt: number;
  commencedAt: Date | null;
  perCargo: { cargoId: string; name: string; plannedMt: number; handledMt: number }[];
  byCrane: { crane: string; mt: number; todayMt: number }[];
  stoppages: { count: number; seconds: number };
  forecast:
    | Forecast
    | { kind: "unavailable"; reason: "NO_TERM" | "REFUSED" | "COMPLETED"; message: string };
};

export async function getLoadingOverview(
  portCallId: string,
  /** Testing seam only; production reads the server clock. */
  now: Date = new Date()
): Promise<ActionResult<LoadingOverview>> {
  try {
    return await authorized<ActionResult<LoadingOverview>>("voyage.read", async (ctx) => {
      const org = ctx.organizationId;
      const [pc] = await db
        .select({ fn: voyagePortCalls.function, timeZone: voyagePortCalls.effectiveTimezone })
        .from(voyagePortCalls)
        .where(and(eq(voyagePortCalls.id, portCallId), eq(voyagePortCalls.organizationId, org)));
      if (!pc) return fail<LoadingOverview>("NOT_FOUND", "Port call not found.");

      const plans = await db
        .select({
          cargoId: cargoPlans.cargoId,
          name: cargoes.name,
          planned: cargoPlans.plannedQuantityMt,
          actual: cargoPlans.actualQuantityMt,
        })
        .from(cargoPlans)
        .innerJoin(cargoes, and(eq(cargoes.id, cargoPlans.cargoId), eq(cargoes.organizationId, org)))
        .where(and(eq(cargoPlans.portCallId, portCallId), eq(cargoPlans.organizationId, org)));

      const shifts = await db
        .select({
          cargoId: shiftPerformances.cargoId,
          day: shiftPerformances.shiftDate,
          crane: shiftPerformances.crane,
          qty: shiftPerformances.quantityMt,
        })
        .from(shiftPerformances)
        .where(and(eq(shiftPerformances.portCallId, portCallId), eq(shiftPerformances.organizationId, org)));

      const lp = getLocalParts(now, pc.timeZone);
      const today = `${lp.year}-${String(lp.month).padStart(2, "0")}-${String(lp.day).padStart(2, "0")}`;

      const perCargo = plans.map((p) => {
        const logged = shifts.filter((s) => s.cargoId === p.cargoId).reduce((a, s) => a + Number(s.qty), 0);
        // The shift log, or the recorded actual when higher (entered at completion).
        const handled = Math.max(logged, p.actual === null ? 0 : Number(p.actual));
        return { cargoId: p.cargoId, name: p.name, plannedMt: Number(p.planned), handledMt: handled };
      });
      const plannedMt = perCargo.reduce((a, c) => a + c.plannedMt, 0);
      const handledMt = perCargo.reduce((a, c) => a + c.handledMt, 0);
      const todayMt = shifts.filter((s) => s.day === today).reduce((a, s) => a + Number(s.qty), 0);

      const craneMap = new Map<string, { mt: number; todayMt: number }>();
      for (const s of shifts) {
        const k = s.crane?.trim() || "Unassigned";
        const e = craneMap.get(k) ?? { mt: 0, todayMt: 0 };
        e.mt += Number(s.qty);
        if (s.day === today) e.todayMt += Number(s.qty);
        craneMap.set(k, e);
      }
      const byCrane = [...craneMap.entries()]
        .map(([crane, v]) => ({ crane, ...v }))
        .sort((a, b) => a.crane.localeCompare(b.crane, "en", { numeric: true }));

      const loaded = await loadPortCallCalcData(ctx, portCallId);
      const events = loaded.kind === "loaded" ? loaded.data.events : [];
      const commenced = events
        .filter((e) => e.semantic === "OPS_COMMENCED")
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];
      const commencedAt = commenced ? commenced.occurredAt : null;

      let stopCount = 0;
      let stopSeconds = 0;
      if (loaded.kind === "loaded" && commencedAt) {
        for (const s of loaded.data.stoppages) {
          const a = Math.max(s.start.getTime(), commencedAt.getTime());
          const b = Math.min((s.end ?? now).getTime(), now.getTime());
          if (b > a) {
            stopCount += 1;
            stopSeconds += (b - a) / 1000;
          }
        }
      }

      let forecast: LoadingOverview["forecast"];
      if (loaded.kind !== "loaded") {
        forecast = {
          kind: "unavailable",
          reason: "NO_TERM",
          message: "Resolve the laytime term to forecast against laytime.",
        };
      } else {
        try {
          const status = computeProvisionalStatus(loaded.data, now);
          if (status.operationsCompletedAt) {
            forecast = { kind: "unavailable", reason: "COMPLETED", message: "Operations are completed." };
          } else {
            forecast = forecastFinish({
              now,
              commencedAt,
              handledMt,
              plannedMt,
              allowedSeconds: status.allowedSeconds,
              usedAt: (t) => computeProvisionalStatus(loaded.data, t).usedSeconds,
            });
          }
        } catch (e) {
          if (!(e instanceof CalculationRefused)) throw e;
          forecast = { kind: "unavailable", reason: "REFUSED", message: e.message };
        }
      }

      return ok<LoadingOverview>({
        fn: pc.fn,
        timeZone: pc.timeZone,
        plannedMt,
        handledMt,
        todayMt,
        commencedAt,
        perCargo,
        byCrane,
        stoppages: { count: stopCount, seconds: stopSeconds },
        forecast,
      });
    });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<LoadingOverview>("FORBIDDEN", "You do not have permission to perform this action.");
    }
    throw e;
  }
}
