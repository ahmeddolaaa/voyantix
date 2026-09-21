import Link from "next/link";
import { authorized } from "@/lib/auth/authorized";
import { listVoyages } from "@/lib/actions/voyages";
import { getStatement } from "@/lib/actions/laytime-statements";
import { PageTitle, EmptyState, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { formatAmount } from "@/lib/format";

/**
 * Portfolio dashboard — the operational overview. Voyages with their statement
 * status and net claim, over a single dark summary band that reads the book at
 * a glance: how many voyages are active, how many statements are finalized,
 * gross demurrage, and the net claim across the book. All figures come from
 * persisted statements.
 */

function IconVoyages() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v20M4 10l8-4 8 4M6 14h12l-2 6H8z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 3h7l4 4v14H7zM14 3v4h4M9 13h6M9 17h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconMoney() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

/**
 * One metric inside the dark summary band. The band is a single coherent
 * surface — cells are divided by hairlines, not broken into separate cards.
 * The primary metric carries a restrained gold accent (top rule + gold icon)
 * so the eye lands on it first without shouting.
 */
function SummaryMetric({
  icon,
  label,
  value,
  note,
  primary = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note?: string;
  primary?: boolean;
}) {
  return (
    <div
      className="relative px-5 py-4"
      style={{ borderLeft: primary ? "none" : "1px solid rgba(255,255,255,0.08)" }}
    >
      {primary && (
        <span
          className="absolute left-0 top-0 h-[3px] w-full"
          style={{ background: "var(--gold)" }}
        />
      )}
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: primary ? "var(--gold)" : "rgba(255,255,255,0.5)" }}>
          {icon}
        </span>
        <span
          className="text-[11.5px] uppercase tracking-wide"
          style={{ color: "rgba(255,255,255,0.62)" }}
        >
          {label}
        </span>
      </div>
      <div
        className="num text-[24px] font-semibold leading-none"
        style={{ color: primary ? "var(--gold)" : "#ffffff" }}
      >
        {value}
      </div>
      {note && (
        <div className="text-[11.5px] mt-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
          {note}
        </div>
      )}
    </div>
  );
}

export default async function PortfolioPage() {
  const ctx = await authorized("voyage.read", async (c) => c);
  const voyages = await listVoyages();
  const rows = voyages.ok ? voyages.data : [];

  const withStatement = await Promise.all(
    rows.map(async (v) => {
      const s = await getStatement(v.id);
      return { voyage: v, stmt: s.ok ? s.data : null };
    })
  );

  const active = rows.filter((v) => v.status === "ACTIVE").length;
  const stmts = withStatement.filter((r) => r.stmt !== null);
  const finalized = stmts.filter((r) => r.stmt!.status === "finalized").length;
  const totalDemurrage = stmts.reduce((sum, r) => sum + r.stmt!.demurrageTotal, 0);
  const totalNet = stmts.reduce((sum, r) => sum + r.stmt!.netClaim, 0);

  const cell = "px-4 py-2.5 text-[13px]";
  const th = "px-4 py-2 text-[11px] uppercase tracking-wide text-left";
  const muted = { color: "var(--steel)" } as const;

  return (
    <div className="max-w-6xl w-full mx-auto px-8 py-8">
      <PageTitle>Portfolio</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={muted}>
        {ctx.organizationName} · signed in as {ctx.userName} ({ctx.role})
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="No voyages yet"
          description="A voyage is the operational spine: port calls, cargo, events and stoppages all hang off it."
          action={
            <Link href="/admin/voyages">
              <SubmitButton pending={false}>Go to voyages</SubmitButton>
            </Link>
          }
        />
      ) : (
        <>
          <div
            className="rounded-lg overflow-hidden mb-6 grid grid-cols-2 md:grid-cols-4"
            style={{ background: "var(--navy)" }}
          >
            <SummaryMetric
              icon={<IconVoyages />}
              label="Voyages"
              value={String(rows.length)}
              note={`${active} active`}
              primary
            />
            <SummaryMetric
              icon={<IconDoc />}
              label="Finalized statements"
              value={String(finalized)}
              note={`of ${stmts.length} with a statement`}
            />
            <SummaryMetric
              icon={<IconMoney />}
              label="Demurrage (gross)"
              value={formatAmount(totalDemurrage)}
              note="across all statements"
            />
            <SummaryMetric
              icon={<IconMoney />}
              label="Net claim (book)"
              value={formatAmount(totalNet)}
              note="demurrage − despatch + adjustments"
            />
          </div>

          <div className="flex items-center justify-between mb-3">
            <span className="font-display text-[15px] font-medium" style={{ color: "var(--ink)" }}>
              Voyages
            </span>
            <Link href="/admin/voyages" className="text-[13px] no-underline" style={{ color: "var(--brass)" }}>
              Manage voyages →
            </Link>
          </div>

          <div className="rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: "var(--bg)", color: "var(--steel)" }}>
                  <th className={th}>Voyage</th>
                  <th className={th}>Vessel</th>
                  <th className={th}>Status</th>
                  <th className={th}>Statement</th>
                  <th className={th} style={{ textAlign: "right" }}>Net claim</th>
                </tr>
              </thead>
              <tbody>
                {withStatement.map(({ voyage: v, stmt }) => (
                  <tr key={v.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className={cell}>
                      <Link
                        href={`/admin/voyages/${v.id}`}
                        className="no-underline"
                        style={{ color: "var(--ink)", fontWeight: 500 }}
                      >
                        {v.voyageReference}
                      </Link>
                    </td>
                    <td className={cell} style={muted}>{v.vesselName}</td>
                    <td className={cell}>
                      <StatusBadge tone={v.status === "ACTIVE" ? "teal" : "neutral"}>
                        {v.status === "ACTIVE" ? "Active" : v.status === "COMPLETED" ? "Completed" : "Cancelled"}
                      </StatusBadge>
                    </td>
                    <td className={cell}>
                      {stmt === null ? (
                        <span style={muted}>—</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <StatusBadge tone={stmt.status === "finalized" ? "brass" : "neutral"}>
                            {stmt.status === "finalized" ? "Finalized" : "Draft"}
                          </StatusBadge>
                          {stmt.unresolvedCount > 0 && (
                            <StatusBadge tone="rust">{stmt.unresolvedCount} unresolved</StatusBadge>
                          )}
                        </span>
                      )}
                    </td>
                    <td className={`${cell} num`} style={{ textAlign: "right", fontWeight: 500 }}>
                      {stmt === null ? <span style={muted}>—</span> : formatAmount(stmt.netClaim)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
