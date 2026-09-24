import Link from "next/link";
import type { ReactNode } from "react";
import { authorized } from "@/lib/auth/authorized";
import { hasPermission } from "@/lib/auth/permissions";
import { loadDashboard, type WorkingPortCall, type DashboardVoyage } from "@/lib/dashboard/load";
import { EmptyState } from "@/components/ui";
import { AutoRefresh } from "@/components/dashboard/AutoRefresh";
import { formatAmount, formatDurationSeconds, sheetBalanceSeconds } from "@/lib/format";

/**
 * Dashboard — the home screen. Claims from stored statements, tonnes from
 * shift records, and the running laytime clock of every port call still
 * working. The page refreshes itself every minute (server-computed figures).
 */

const eyebrow = "text-[11px] font-semibold uppercase tracking-[.12em]";

function Panel({
  children,
  className = "",
  delay,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={`rounded-[14px] ${className}`}
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-card)",
        animationDelay: delay !== undefined ? `${delay}ms` : undefined,
      }}
    >
      {children}
    </div>
  );
}

function Bar({ pct, color, height = 8 }: { pct: number; color: string; height?: number }) {
  return (
    <div className="rounded-full overflow-hidden" style={{ height, background: "var(--line-soft)" }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 126},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg width="128" height="30" viewBox="0 0 128 30" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({
  label,
  value,
  note,
  accent,
  spark,
  delay,
}: {
  label: string;
  value: string;
  note: string;
  accent: string;
  spark?: number[];
  delay: number;
}) {
  return (
    <Panel className="vx-rise px-[22px] py-5 flex flex-col gap-2.5" delay={delay}>
      <span className={eyebrow} style={{ color: "var(--steel)" }}>
        {label}
      </span>
      <div className="flex items-end justify-between gap-3">
        <span className="font-display num text-[32px] font-semibold leading-none" style={{ color: accent }}>
          {value}
        </span>
        {spark && spark.some((v) => v > 0) && <Sparkline values={spark} color={accent} />}
      </div>
      <span className="text-[12.5px]" style={{ color: "var(--ink-soft)" }}>
        {note}
      </span>
    </Panel>
  );
}

function tonnes(n: number) {
  return Math.round(n).toLocaleString("en-GB");
}

function WorkingCard({ w }: { w: WorkingPortCall }) {
  const c = w.clock;
  const over = c?.onDemurrage ?? false;
  const color = over ? "var(--coral)" : "var(--teal)";
  const usedPct = c && c.allowedSeconds > 0 ? (c.usedSeconds / c.allowedSeconds) * 100 : 0;
  const balance = c ? sheetBalanceSeconds(c.allowedSeconds, c.usedSeconds) : 0;
  const cargoPct = w.plannedMt > 0 ? (w.handledMt / w.plannedMt) * 100 : 0;
  const verb = w.fn === "LOAD" ? "Loaded" : "Discharged";
  return (
    <Link
      href={`/admin/voyages/${w.voyageId}`}
      className="flex flex-col gap-3.5 p-[18px] rounded-xl no-underline transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]"
      style={{
        border: `1px solid ${over ? "#f1cfc6" : "var(--line)"}`,
        background: over ? "#fff8f5" : "var(--card)",
        color: "var(--ink)",
      }}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-display text-[16px] font-semibold truncate">{w.vesselName}</span>
          <span className="text-[12.5px]" style={{ color: "var(--ink-soft)" }}>
            {w.portName} · {w.fn === "LOAD" ? "Loading" : "Discharging"}
          </span>
        </div>
        {c && (
          <span
            className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
            style={{ background: over ? "var(--coral-soft)" : "var(--teal-soft)", color }}
          >
            {over ? "On demurrage" : "On laytime"}
          </span>
        )}
      </div>
      {c ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-[12px]" style={{ color: "var(--steel)" }}>
              {over ? "Over laytime" : "Laytime left"}
            </span>
            <span className="num text-[26px] font-semibold" style={{ color }}>
              {over ? "+" : ""}
              {formatDurationSeconds(Math.abs(balance))}
            </span>
          </div>
          <Bar pct={usedPct} color={color} />
          <div className="flex justify-between text-[12px]" style={{ color: "var(--ink-soft)" }}>
            <span className="num">{formatDurationSeconds(c.usedSeconds)} used</span>
            <span className="num">of {formatDurationSeconds(c.allowedSeconds)}</span>
          </div>
        </>
      ) : (
        <span className="text-[12.5px]" style={{ color: "var(--steel)" }}>
          Laytime clock not available for this port call yet.
        </span>
      )}
      {w.plannedMt > 0 && (
        <div className="flex flex-col gap-2 pt-3" style={{ borderTop: "1px dashed var(--line)" }}>
          <div className="flex justify-between items-baseline">
            <span className="text-[12px]" style={{ color: "var(--steel)" }}>
              {verb}
            </span>
            <span className="num text-[13.5px] font-semibold" style={{ color: "var(--navy)" }}>
              {tonnes(w.handledMt)} / {tonnes(w.plannedMt)} MT
            </span>
          </div>
          <Bar pct={cargoPct} color="var(--brass)" />
          <span className="num text-[12px]" style={{ color: "var(--ink-soft)" }}>
            {w.handledMt >= w.plannedMt ? "Plan reached" : `${tonnes(w.plannedMt - w.handledMt)} MT to go`}
          </span>
        </div>
      )}
    </Link>
  );
}

function statusChip(v: DashboardVoyage) {
  const s = v.statement;
  if (!s) {
    return v.status === "ACTIVE"
      ? { label: "In operation", bg: "var(--teal-soft)", fg: "var(--teal)" }
      : { label: v.status === "COMPLETED" ? "Completed" : "Cancelled", bg: "var(--line-soft)", fg: "var(--steel)" };
  }
  if (s.netClaim > 0) return { label: "Demurrage", bg: "var(--coral-soft)", fg: "var(--coral)" };
  if (s.netClaim < 0) return { label: "Despatch", bg: "var(--teal-soft)", fg: "var(--teal)" };
  return { label: "Settled even", bg: "var(--line-soft)", fg: "var(--steel)" };
}

export default async function DashboardPage() {
  const ctx = await authorized("voyage.read", async (c) => c);
  const d = await loadDashboard(ctx);
  const first = ctx.userName.split(/\s+/)[0];
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const onDem = d.working.filter((w) => w.clock?.onDemurrage).length;
  const monthMax = Math.max(1, ...d.months.flatMap((m) => [m.demurrage, m.despatch]));
  const pipelineTotal = d.claims.draftCount + d.claims.finalizedCount + d.claims.noStatementCount || 1;
  const canWrite = hasPermission(ctx, "voyage.write");

  return (
    <div className="max-w-[1440px] w-full mx-auto px-6 lg:px-9 py-8 flex flex-col gap-6">
      <AutoRefresh />
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <span className={eyebrow} style={{ color: "var(--steel)" }}>
            {today}
          </span>
          <h1 className="m-0 font-display text-[30px] font-bold" style={{ color: "var(--navy)" }}>
            Welcome back, {first}
          </h1>
        </div>
        {canWrite && (
          <Link
            href="/admin/voyages"
            className="ml-auto inline-flex items-center gap-2 h-10 px-4 rounded-[10px] text-[13.5px] font-medium no-underline"
            style={{ background: "var(--navy)", color: "#fff" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            New voyage
          </Link>
        )}
      </div>

      {d.voyages.length === 0 ? (
        <EmptyState
          title="No voyages yet"
          description="A voyage is the operational spine: port calls, cargo, events and stoppages all hang off it."
          action={
            <Link href="/admin/voyages" className="text-[13.5px] font-medium" style={{ color: "var(--teal)" }}>
              Go to voyages →
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi
              label="Demurrage in statements"
              value={formatAmount(d.claims.demurrage)}
              note={`${d.claims.draftCount} draft · ${d.claims.finalizedCount} finalized`}
              accent="var(--coral)"
              delay={0}
            />
            <Kpi
              label="Tonnes · last 7 days"
              value={tonnes(d.tonnesThisWeek)}
              note={`MT from shift records · ${d.working.length} working now`}
              accent="var(--brass)"
              spark={d.weeklyTonnes}
              delay={80}
            />
            <Kpi
              label="Despatch in statements"
              value={formatAmount(d.claims.despatch)}
              note="earned by finishing inside laytime"
              accent="var(--teal)"
              delay={160}
            />
            <Kpi
              label="Net claim · book"
              value={formatAmount(d.claims.net)}
              note="demurrage − despatch + adjustments"
              accent="var(--navy)"
              delay={240}
            />
          </div>

          {d.working.length > 0 && (
            <Panel className="px-6 py-[22px] flex flex-col gap-[18px]">
              <div className="flex items-center gap-2.5">
                <span className="vx-live" />
                <h2 className="m-0 font-display text-[18px] font-semibold">Working now</h2>
                <span className="text-[12.5px]" style={{ color: "var(--steel)" }}>
                  laytime clock and cargo · refreshes every minute
                  {onDem > 0 ? ` · ${onDem} on demurrage` : ""}
                </span>
                <Link href="/admin/voyages" className="ml-auto text-[13px] font-medium" style={{ color: "var(--teal)" }}>
                  All voyages →
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {d.working.map((w) => (
                  <WorkingCard key={w.portCallId} w={w} />
                ))}
              </div>
            </Panel>
          )}

          <div className="flex flex-col xl:flex-row gap-4">
            <Panel className="flex-1 min-w-0 px-6 py-[22px] flex flex-col gap-[18px]">
              <div className="flex items-center gap-4 flex-wrap">
                <h2 className="m-0 font-display text-[18px] font-semibold">Demurrage vs despatch</h2>
                <div className="flex gap-3.5 text-[12.5px] ml-auto" style={{ color: "var(--ink-soft)" }}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: "var(--coral)" }} />
                    Demurrage
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: "var(--teal)" }} />
                    Despatch
                  </span>
                </div>
              </div>
              <div className="flex gap-2 items-end pb-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
                {d.months.map((m) => (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-2">
                    <div className="h-[180px] flex items-end gap-1.5">
                      <div
                        title={`Demurrage ${m.label}: ${formatAmount(m.demurrage)}`}
                        className="w-[22px] rounded-t-md"
                        style={{ height: `${(m.demurrage / monthMax) * 180}px`, background: "var(--coral)", minHeight: m.demurrage > 0 ? 3 : 0 }}
                      />
                      <div
                        title={`Despatch ${m.label}: ${formatAmount(m.despatch)}`}
                        className="w-[22px] rounded-t-md"
                        style={{ height: `${(m.despatch / monthMax) * 180}px`, background: "var(--teal)", minHeight: m.despatch > 0 ? 3 : 0 }}
                      />
                    </div>
                    <span className="text-[12px]" style={{ color: "var(--steel)" }}>
                      {m.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-8 text-[13px] flex-wrap">
                <span>
                  <span style={{ color: "var(--steel)" }}>Demurrage · 6 mo </span>
                  <span className="num font-semibold">{formatAmount(d.months.reduce((a, m) => a + m.demurrage, 0))}</span>
                </span>
                <span>
                  <span style={{ color: "var(--steel)" }}>Despatch · 6 mo </span>
                  <span className="num font-semibold">{formatAmount(d.months.reduce((a, m) => a + m.despatch, 0))}</span>
                </span>
                <span className="text-[12px]" style={{ color: "var(--steel)" }}>
                  by month laytime ended, from statements
                </span>
              </div>
            </Panel>

            <Panel className="xl:w-[380px] shrink-0 px-6 py-[22px] flex flex-col gap-1.5">
              <h2 className="m-0 mb-1.5 font-display text-[18px] font-semibold">Statements</h2>
              <div className="flex h-2.5 rounded-full overflow-hidden mb-2" style={{ background: "var(--line-soft)" }}>
                <div style={{ width: `${(d.claims.noStatementCount / pipelineTotal) * 100}%`, background: "var(--slate)" }} />
                <div style={{ width: `${(d.claims.draftCount / pipelineTotal) * 100}%`, background: "var(--rust)" }} />
                <div style={{ width: `${(d.claims.finalizedCount / pipelineTotal) * 100}%`, background: "var(--navy)" }} />
              </div>
              {[
                { label: "No statement yet", count: d.claims.noStatementCount, amount: null, color: "var(--slate)" },
                { label: "Draft", count: d.claims.draftCount, amount: d.claims.draftNet, color: "var(--rust)" },
                { label: "Finalized", count: d.claims.finalizedCount, amount: d.claims.finalizedNet, color: "var(--navy)" },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3.5 py-3.5" style={{ borderBottom: "1px solid var(--line-soft)" }}>
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: r.color }} />
                  <span className="text-[14px] font-medium">{r.label}</span>
                  <span
                    className="ml-auto inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold"
                    style={{ border: "1px solid var(--line)", color: "var(--ink-soft)" }}
                  >
                    {r.count}
                  </span>
                  <span className="num w-[110px] text-right font-semibold">
                    {r.amount === null ? "—" : formatAmount(r.amount)}
                  </span>
                </div>
              ))}
              <span className="text-[12px] pt-2" style={{ color: "var(--steel)" }}>
                Amounts are net claims.
              </span>
            </Panel>
          </div>

          <Panel className="overflow-hidden">
            <div className="flex items-center px-5 py-[18px]">
              <h2 className="m-0 font-display text-[18px] font-semibold">Recent voyages</h2>
              <Link href="/admin/voyages" className="ml-auto text-[13px] font-medium" style={{ color: "var(--teal)" }}>
                View all →
              </Link>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: "var(--bg-subtle)" }}>
                  {["Voyage", "Route", "State", "Statement", "Net claim"].map((h, i) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[.08em]"
                      style={{ color: "var(--steel)", textAlign: i === 4 ? "right" : "left", borderBottom: "1px solid var(--line)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.voyages.slice(0, 8).map((v) => {
                  const chip = statusChip(v);
                  const net = v.statement?.netClaim ?? null;
                  return (
                    <tr key={v.id} style={{ borderTop: "1px solid var(--line-soft)" }}>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <Link href={`/admin/voyages/${v.id}`} className="font-semibold no-underline" style={{ color: "var(--ink)" }}>
                            {v.vesselName}
                          </Link>
                          <span className="num text-[12px]" style={{ color: "var(--steel)" }}>
                            {v.voyageReference}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-[13.5px]" style={{ color: "var(--ink-soft)" }}>
                        {v.route.length ? v.route.join(" → ") : "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold"
                          style={{ background: chip.bg, color: chip.fg }}
                        >
                          {chip.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-[13px]" style={{ color: "var(--ink-soft)" }}>
                        {v.statement ? (v.statement.status === "finalized" ? "Finalized" : "Draft") : "—"}
                        {v.statement && v.statement.unresolvedCount > 0 ? ` · ${v.statement.unresolvedCount} unresolved` : ""}
                      </td>
                      <td
                        className="px-5 py-3.5 num text-right font-semibold"
                        style={{ color: net === null ? "var(--steel)" : net > 0 ? "var(--coral)" : net < 0 ? "var(--teal)" : "var(--ink)" }}
                      >
                        {net === null ? "—" : formatAmount(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}
