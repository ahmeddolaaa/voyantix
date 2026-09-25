/**
 * DASHBOARD LOADER — one read for the home screen. Not a server action: it is
 * called from the (server) dashboard page after authorization, with that
 * page's TenantContext. Every query is scoped to ctx.organizationId.
 *
 * Everything shown comes from stored records: statements (claims), cargo
 * plans and shift performances (tonnes), and the provisional laytime status
 * the voyage page already shows (running clock). Nothing is estimated here.
 */

import { db } from "@/db/client";
import {
  voyages,
  voyagePortCalls,
  ports,
  cargoPlans,
  shiftPerformances,
  statementScopeResults,
  laytimeStatements,
  laytimeCalculations,
} from "@/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { TenantContext } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { getProvisionalStatus } from "@/lib/actions/provisional-status";
import { getStatement, type StatementView } from "@/lib/actions/laytime-statements";

export type WorkingPortCall = {
  portCallId: string;
  voyageId: string;
  voyageReference: string;
  vesselName: string;
  portName: string;
  fn: "LOAD" | "DISCHARGE";
  /** Running laytime clock, or null when it cannot be shown (refused / no access). */
  clock: {
    allowedSeconds: number;
    usedSeconds: number;
    remainingSeconds: number;
    onDemurrage: boolean;
    asOf: string;
  } | null;
  plannedMt: number;
  handledMt: number;
};

export type DashboardVoyage = {
  id: string;
  voyageReference: string;
  vesselName: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  route: string[];
  statement: StatementView | null;
};

export type MonthBucket = { key: string; label: string; demurrage: number; despatch: number };

export type DashboardData = {
  voyages: DashboardVoyage[];
  working: WorkingPortCall[];
  tonnesThisWeek: number;
  weeklyTonnes: number[]; // oldest → newest, 8 ISO weeks ending this week
  months: MonthBucket[]; // last 6 calendar months, oldest → newest
  claims: {
    demurrage: number;
    despatch: number;
    net: number;
    draftCount: number;
    draftNet: number;
    finalizedCount: number;
    finalizedNet: number;
    noStatementCount: number;
  };
};

const DAY = 86_400_000;

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function loadDashboard(ctx: TenantContext, now = new Date()): Promise<DashboardData> {
  const org = ctx.organizationId;

  // ---------------------------------------------------------------- voyages
  const voyageRows = await db
    .select({
      id: voyages.id,
      voyageReference: voyages.voyageReference,
      vesselName: voyages.vesselName,
      status: voyages.status,
      createdAt: voyages.createdAt,
    })
    .from(voyages)
    .where(eq(voyages.organizationId, org))
    .orderBy(sql`${voyages.createdAt} desc`);

  const pcRows = voyageRows.length
    ? await db
        .select({
          id: voyagePortCalls.id,
          voyageId: voyagePortCalls.voyageId,
          fn: voyagePortCalls.function,
          status: voyagePortCalls.status,
          sequence: voyagePortCalls.sequence,
          portName: ports.name,
        })
        .from(voyagePortCalls)
        .innerJoin(ports, and(eq(ports.id, voyagePortCalls.portId), eq(ports.organizationId, org)))
        .where(eq(voyagePortCalls.organizationId, org))
        .orderBy(voyagePortCalls.sequence)
    : [];

  const statements = await Promise.all(
    voyageRows.map(async (v) => {
      const s = await getStatement(v.id);
      return s.ok ? s.data : null;
    })
  );

  const dashVoyages: DashboardVoyage[] = voyageRows.map((v, i) => ({
    id: v.id,
    voyageReference: v.voyageReference,
    vesselName: v.vesselName,
    status: v.status,
    route: pcRows.filter((p) => p.voyageId === v.id).map((p) => p.portName),
    statement: statements[i],
  }));

  // ------------------------------------------------------------- cargo + shifts
  const pcIds = pcRows.map((p) => p.id);
  const planRows = pcIds.length
    ? await db
        .select({
          portCallId: cargoPlans.portCallId,
          planned: sql<string>`coalesce(sum(${cargoPlans.plannedQuantityMt}), 0)`,
          actual: sql<string>`coalesce(sum(${cargoPlans.actualQuantityMt}), 0)`,
        })
        .from(cargoPlans)
        .where(and(eq(cargoPlans.organizationId, org), inArray(cargoPlans.portCallId, pcIds)))
        .groupBy(cargoPlans.portCallId)
    : [];
  const shiftRows = pcIds.length
    ? await db
        .select({
          portCallId: shiftPerformances.portCallId,
          handled: sql<string>`coalesce(sum(${shiftPerformances.quantityMt}), 0)`,
        })
        .from(shiftPerformances)
        .where(and(eq(shiftPerformances.organizationId, org), inArray(shiftPerformances.portCallId, pcIds)))
        .groupBy(shiftPerformances.portCallId)
    : [];

  // 8 weeks of shift tonnage (by shift date), newest last.
  const weekStart = new Date(now.getTime() - 7 * 8 * DAY + DAY);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const recent = await db
    .select({ day: shiftPerformances.shiftDate, qty: shiftPerformances.quantityMt })
    .from(shiftPerformances)
    .where(and(eq(shiftPerformances.organizationId, org), gte(shiftPerformances.shiftDate, weekStartIso)));
  const weeklyTonnes = Array.from({ length: 8 }, () => 0);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const r of recent) {
    const ageDays = Math.floor((todayMs - Date.parse(`${r.day}T00:00:00Z`)) / DAY);
    const idx = 7 - Math.floor(ageDays / 7);
    if (idx >= 0 && idx < 8) weeklyTonnes[idx] += Number(r.qty);
  }

  // ------------------------------------------------------------ working now
  const canClock = hasPermission(ctx, "statement.recalculate");
  const activeVoyageIds = new Set(voyageRows.filter((v) => v.status === "ACTIVE").map((v) => v.id));
  const candidates = pcRows.filter((p) => p.status === "ACTIVE" && activeVoyageIds.has(p.voyageId));
  const working: WorkingPortCall[] = [];
  for (const p of candidates) {
    const v = voyageRows.find((x) => x.id === p.voyageId)!;
    let clock: WorkingPortCall["clock"] = null;
    let completed = false;
    if (canClock) {
      const r = await getProvisionalStatus(p.id, now);
      if (r.ok && r.data.status === "provisional") {
        completed = r.data.operationsCompletedAt !== null;
        clock = {
          allowedSeconds: r.data.allowedSeconds,
          usedSeconds: r.data.usedSeconds,
          remainingSeconds: r.data.remainingSeconds,
          onDemurrage: r.data.onDemurrage,
          asOf: r.data.asOf.toISOString(),
        };
      }
    }
    const plannedMt = Number(planRows.find((x) => x.portCallId === p.id)?.planned ?? 0);
    // Tonnes handled so far: the shift log, or the recorded actual quantity
    // when that is higher (actuals are entered once the operation is done).
    const handledMt = Math.max(
      Number(shiftRows.find((x) => x.portCallId === p.id)?.handled ?? 0),
      Number(planRows.find((x) => x.portCallId === p.id)?.actual ?? 0)
    );
    // "Working now" = laytime running and operations not completed, or — for
    // roles without the clock — cargo still moving against its plan.
    const running = clock ? !completed : handledMt > 0 && handledMt < plannedMt;
    if (!running) continue;
    working.push({
      portCallId: p.id,
      voyageId: p.voyageId,
      voyageReference: v.voyageReference,
      vesselName: v.vesselName,
      portName: p.portName,
      fn: p.fn,
      clock,
      plannedMt,
      handledMt,
    });
  }

  // --------------------------------------------------------- claims by month
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const scopeRows = await db
    .select({
      kind: statementScopeResults.settlementKind,
      amount: statementScopeResults.amount,
      windowEnd: laytimeCalculations.windowEnd,
    })
    .from(statementScopeResults)
    .innerJoin(
      laytimeStatements,
      and(
        eq(laytimeStatements.id, statementScopeResults.statementId),
        eq(laytimeStatements.organizationId, org)
      )
    )
    .innerJoin(
      laytimeCalculations,
      and(
        eq(laytimeCalculations.id, statementScopeResults.calculationId),
        eq(laytimeCalculations.organizationId, org)
      )
    )
    .where(and(eq(statementScopeResults.organizationId, org), gte(laytimeCalculations.windowEnd, monthStart)));
  const months: MonthBucket[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
    return {
      key: monthKey(d),
      label: d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
      demurrage: 0,
      despatch: 0,
    };
  });
  for (const r of scopeRows) {
    if (!r.windowEnd || r.amount === null) continue;
    const b = months.find((m) => m.key === monthKey(r.windowEnd!));
    if (!b) continue;
    if (r.kind === "demurrage") b.demurrage += Number(r.amount);
    if (r.kind === "despatch") b.despatch += Number(r.amount);
  }

  // ------------------------------------------------------------------ claims
  const withStmt = dashVoyages.filter((v) => v.statement);
  const drafts = withStmt.filter((v) => v.statement!.status === "draft");
  const finals = withStmt.filter((v) => v.statement!.status === "finalized");
  const sum = (xs: DashboardVoyage[], f: (s: StatementView) => number) =>
    xs.reduce((a, v) => a + f(v.statement!), 0);

  return {
    voyages: dashVoyages,
    working,
    tonnesThisWeek: weeklyTonnes[7],
    weeklyTonnes,
    months,
    claims: {
      demurrage: sum(withStmt, (s) => s.demurrageTotal),
      despatch: sum(withStmt, (s) => s.despatchTotal),
      net: sum(withStmt, (s) => s.netClaim),
      draftCount: drafts.length,
      draftNet: sum(drafts, (s) => s.netClaim),
      finalizedCount: finals.length,
      finalizedNet: sum(finals, (s) => s.netClaim),
      noStatementCount: dashVoyages.length - withStmt.length,
    },
  };
}
