"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, SecondaryButton, StatusBadge } from "@/components/ui";
import { finalizeStatement } from "@/lib/actions/laytime-statements";
import { formatInstant, formatDurationSeconds, formatAmount, sheetBalanceSeconds } from "@/lib/format";
import type { PortCallSheet } from "@/lib/actions/port-call-sheet";
import { PortCallSheetView } from "@/components/admin/PortCallSheetView";

/**
 * Printable laytime / demurrage statement — the document a broker sends to the
 * counterparty. Screen and print share one layout; @media print (globals.css)
 * drops the app chrome and the .no-print controls so what prints is just the
 * paper. All figures come from the persisted statement and calculations; the
 * document computes nothing.
 */

export type DocScope = {
  label: string;
  timeZone: string;
  outcome: "SAVED" | "EXCEEDED" | "EXACT" | null;
  allowedSeconds: number | null;
  usedSeconds: number | null;
  balanceSeconds: number | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  settlementKind: "demurrage" | "despatch" | "none" | "settlement_refused" | "calc_refused";
  amount: number | null;
  note: string | null;
};

/** One port call's detailed laytime sheet (or why it is not shown). */
export type DocSheet = { title: string; sheet: PortCallSheet | null; note: string | null };

export type StatementDoc = {
  voyageId: string;
  /** The issuing company (the tenant) — the statement is theirs, not Voyantix's. */
  issuer: string;
  /** Prepared date shown on the letterhead (finalized date, else today), DD/MM/YYYY. */
  preparedOn: string;
  /** The draft was built from calculations that have since changed. */
  outdated: boolean;
  unresolvedCount: number;
  canFinalize: boolean;
  voyageReference: string;
  vesselName: string;
  counterparty: string | null;
  contractReference: string | null;
  status: "draft" | "finalized";
  finalizedAt: Date | null;
  demurrageTotal: number;
  despatchTotal: number;
  adjustmentsTotal: number;
  netClaim: number;
  adjustments: { amount: number; reason: string }[];
  scopes: DocScope[];
  sheets: DocSheet[];
};

function settlementText(s: DocScope): string {
  switch (s.settlementKind) {
    case "demurrage":
      return `Demurrage ${s.amount === null ? "" : formatAmount(s.amount)}`;
    case "despatch":
      return `Despatch ${s.amount === null ? "" : formatAmount(s.amount)}`;
    case "none":
      return "—";
    case "settlement_refused":
      return "Despatch basis undefined";
    case "calc_refused":
      return "Calculation refused";
  }
}

const cell = "px-3 py-2 text-[12.5px] align-top";
const th = "px-3 py-2 text-[11px] uppercase tracking-wide text-left";

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Right rail: the claim, where the statement stands, and what to do next. Not printed. */
function ClaimRail({ doc }: { doc: StatementDoc }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const finalized = doc.status === "finalized";
  const net = doc.netClaim;
  const netColor = net > 0 ? "var(--coral)" : net < 0 ? "var(--teal)" : "var(--navy)";
  const blocked = doc.outdated ? "The draft is outdated — rebuild it on the voyage page first." : doc.unresolvedCount > 0 ? `${doc.unresolvedCount} port call(s) unresolved — resolve them first.` : null;

  function finalize() {
    setError(null);
    start(async () => {
      const r = await finalizeStatement(doc.voyageId);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      router.refresh();
    });
  }

  const step = (done: boolean, title: string, sub: string) => (
    <div className="flex gap-3 items-start">
      <span
        className="mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center"
        style={{
          background: done ? "var(--teal)" : "transparent",
          border: done ? "none" : "2px solid var(--brass)",
        }}
        aria-hidden
      >
        {done && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-[12px]" style={{ color: "var(--steel)" }}>
          {sub}
        </span>
      </div>
    </div>
  );

  return (
    <aside className="no-print lg:w-[300px] shrink-0 flex flex-col gap-4 lg:sticky lg:top-6 self-start">
      <div
        className="rounded-[14px] p-5 flex flex-col gap-4"
        style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--shadow-card)" }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[.12em]" style={{ color: "var(--steel)" }}>
          {net < 0 ? "Despatch due" : "Net claim"}
        </span>
        <span className="font-display num text-[32px] font-semibold leading-none" style={{ color: netColor }}>
          {formatAmount(Math.abs(net))}
        </span>
        <div className="flex flex-col gap-3">
          {step(true, "Draft built", doc.outdated ? "Outdated — a port call was recalculated since" : "From the current calculations")}
          {step(finalized, "Finalized", finalized ? `Locked · ${doc.preparedOn}` : "Locks the figures")}
        </div>
        {error && (
          <p role="alert" className="m-0 text-[12.5px]" style={{ color: "var(--coral)" }}>
            {error}
          </p>
        )}
        {!finalized && doc.canFinalize && (
          <>
            <PrimaryButton onClick={finalize} disabled={pending || blocked !== null} className="w-full">
              {pending ? "Finalizing…" : "Finalize statement"}
            </PrimaryButton>
            {blocked && (
              <p className="m-0 text-[12px]" style={{ color: "var(--steel)" }}>
                {blocked}
              </p>
            )}
          </>
        )}
        <SecondaryButton onClick={() => window.print()} className="w-full">
          Print / Save PDF
        </SecondaryButton>
      </div>
      <div
        className="rounded-[14px] p-5 flex flex-col gap-2"
        style={{ background: "var(--card)", border: "1px solid var(--line)" }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[.12em]" style={{ color: "var(--steel)" }}>
          Adjustments
        </span>
        {doc.adjustments.length === 0 ? (
          <span className="text-[12.5px]" style={{ color: "var(--ink-soft)" }}>
            None.
          </span>
        ) : (
          doc.adjustments.map((a, i) => (
            <div key={i} className="flex justify-between gap-3 text-[12.5px]">
              <span style={{ color: "var(--ink-soft)" }}>{a.reason}</span>
              <span className="num font-semibold">{formatAmount(a.amount)}</span>
            </div>
          ))
        )}
        {!finalized && (
          <Link href={`/admin/voyages/${doc.voyageId}#statement`} className="text-[12.5px] font-medium" style={{ color: "var(--teal)" }}>
            Add or rebuild on the voyage page →
          </Link>
        )}
      </div>
    </aside>
  );
}

export function StatementDocument({ doc }: { doc: StatementDoc }) {
  const muted = { color: "var(--steel)" } as const;

  return (
    <div className="max-w-[1240px] mx-auto px-6 lg:px-9 py-8">
      <div className="no-print flex flex-col gap-1.5 mb-6">
        <Link
          href={`/admin/voyages/${doc.voyageId}`}
          className="text-[12.5px] font-medium no-underline hover:underline self-start"
          style={{ color: "var(--teal)" }}
        >
          ← Back to voyage
        </Link>
        <span className="num text-[11.5px] font-semibold uppercase tracking-[.12em]" style={muted}>
          {doc.vesselName} · {doc.voyageReference}
        </span>
        <h1 className="m-0 font-display text-[28px] font-bold" style={{ color: "var(--navy)" }}>
          Statement
        </h1>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div
        className="print-document flex-1 min-w-0 rounded-[14px] p-10"
        style={{
          background: "var(--card)",
          border: "1px solid var(--line)",
          boxShadow: "0 1px 2px rgba(19,38,44,.05), 0 18px 40px -20px rgba(11,42,51,.25)",
        }}
      >
        {/* Letterhead — the issuing company */}
        <div className="flex items-start justify-between pb-5 mb-6" style={{ borderBottom: "2px solid var(--navy)" }}>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span
                className="w-7 h-7 rounded-md flex items-center justify-center font-display text-[11.5px] font-bold text-white"
                style={{ background: "var(--navy)" }}
              >
                {initialsOf(doc.issuer)}
              </span>
              <span className="font-display text-[14px] font-semibold" style={{ color: "var(--navy)" }}>
                {doc.issuer}
              </span>
            </div>
            <div className="font-display text-[26px] font-bold" style={{ color: "var(--navy)" }}>
              Laytime statement
            </div>
            <div className="text-[13px] mt-1" style={muted}>
              {doc.vesselName} · Voyage {doc.voyageReference}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge tone={doc.status === "finalized" ? "teal" : "neutral"}>
              {doc.status === "finalized" ? "Finalized" : "Draft"}
            </StatusBadge>
            <span className="text-[12px]" style={muted}>
              Prepared {doc.preparedOn}
            </span>
          </div>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-2 gap-4 text-[12.5px] mb-6">
          <div>
            <div style={muted}>Counterparty</div>
            <div style={{ fontWeight: 500 }}>{doc.counterparty ?? "—"}</div>
          </div>
          <div>
            <div style={muted}>Charterparty</div>
            <div style={{ fontWeight: 500 }}>{doc.contractReference ?? "—"}</div>
          </div>
        </div>

        {/* Per-port-call breakdown */}
        <div className="rounded-md overflow-hidden mb-6" style={{ border: "1px solid var(--line)" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "var(--bg)", color: "var(--steel)" }}>
                <th className={th}>Port call</th>
                <th className={th}>Laytime window</th>
                <th className={th}>Allowed</th>
                <th className={th}>Used</th>
                <th className={th}>Balance</th>
                <th className={th} style={{ textAlign: "right" }}>Settlement</th>
              </tr>
            </thead>
            <tbody>
              {doc.scopes.map((s, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className={cell} style={{ fontWeight: 500 }}>{s.label}</td>
                  <td className={cell} style={muted}>
                    {s.windowStart && s.windowEnd
                      ? `${formatInstant(new Date(s.windowStart), s.timeZone)} → ${formatInstant(
                          new Date(s.windowEnd),
                          s.timeZone
                        )}`
                      : "—"}
                  </td>
                  <td className={`${cell} num`}>
                    {s.allowedSeconds === null ? "—" : formatDurationSeconds(s.allowedSeconds)}
                  </td>
                  <td className={`${cell} num`}>
                    {s.usedSeconds === null ? "—" : formatDurationSeconds(s.usedSeconds)}
                  </td>
                  <td className={`${cell} num`}>
                    {s.balanceSeconds === null
                      ? "—"
                      : formatDurationSeconds(
                          s.allowedSeconds !== null && s.usedSeconds !== null
                            ? sheetBalanceSeconds(s.allowedSeconds, s.usedSeconds)
                            : s.balanceSeconds
                        )}
                  </td>
                  <td
                    className={`${cell} num`}
                    style={{
                      textAlign: "right",
                      color:
                        s.settlementKind === "demurrage"
                          ? "var(--coral)"
                          : s.settlementKind === "despatch"
                            ? "var(--teal)"
                            : "var(--steel)",
                      fontWeight: 500,
                    }}
                  >
                    {settlementText(s)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Adjustments */}
        {doc.adjustments.length > 0 && (
          <div className="mb-6">
            <div className="text-[12px] uppercase tracking-wide mb-2" style={muted}>
              Adjustments
            </div>
            {doc.adjustments.map((a, i) => (
              <div key={i} className="flex justify-between text-[12.5px] py-0.5">
                <span style={muted}>{a.reason}</span>
                <span className="num" style={{ fontWeight: 500 }}>{formatAmount(a.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-72 text-[13px]">
            <div className="flex justify-between py-1">
              <span style={muted}>Demurrage</span>
              <span className="num">{formatAmount(doc.demurrageTotal)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span style={muted}>Despatch</span>
              <span className="num">{formatAmount(doc.despatchTotal)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span style={muted}>Adjustments</span>
              <span className="num">{formatAmount(doc.adjustmentsTotal)}</span>
            </div>
            <div
              className="flex justify-between py-2 mt-1"
              style={{ borderTop: "2px solid var(--brand)", fontWeight: 700 }}
            >
              <span>Net claim</span>
              <span className="num" style={{ color: "var(--brand)" }}>
                {formatAmount(doc.netClaim)}
              </span>
            </div>
          </div>
        </div>

        {/* Detailed laytime calculation per port call */}
        {doc.sheets.map((d, i) =>
          d.sheet ? (
            <PortCallSheetView key={i} sheet={d.sheet} title={d.title} />
          ) : (
            <div key={i} className="mt-6 text-[12px]" style={muted}>
              {d.title}: {d.note}
            </div>
          )
        )}

        {/* Footer */}
        <div className="text-[11px] mt-6 pt-3" style={{ ...muted, borderTop: "1px solid var(--line)" }}>
          {doc.status === "finalized" && doc.finalizedAt
            ? `Finalized ${formatInstant(new Date(doc.finalizedAt), "UTC")} UTC. Amounts are in the charterparty's currency.`
            : "DRAFT — not yet finalized. Figures may change until the statement is finalized."}
        </div>
        <div className="text-[10.5px] mt-2" style={muted}>
          Prepared with Voyantix
        </div>
      </div>
      <ClaimRail doc={doc} />
      </div>
    </div>
  );
}
