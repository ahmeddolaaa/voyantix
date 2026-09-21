"use client";

import Link from "next/link";
import { PrimaryButton, StatusBadge } from "@/components/ui";
import { BrandMark } from "@/components/BrandMark";
import { formatInstant, formatDurationSeconds, formatAmount } from "@/lib/format";

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

export type StatementDoc = {
  voyageId: string;
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

export function StatementDocument({ doc }: { doc: StatementDoc }) {
  const muted = { color: "var(--steel)" } as const;

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="no-print flex items-center justify-between mb-4">
        <Link
          href={`/admin/voyages/${doc.voyageId}`}
          className="text-[13px] no-underline"
          style={{ color: "var(--brass)" }}
        >
          ← Back to voyage
        </Link>
        <PrimaryButton onClick={() => window.print()}>Print / Save PDF</PrimaryButton>
      </div>

      <div
        className="print-document rounded-lg p-8"
        style={{
          background: "var(--card)",
          border: "1px solid var(--line)",
          boxShadow: "0 1px 2px rgba(19,38,44,.05), 0 10px 28px rgba(19,38,44,.07)",
        }}
      >
        {/* Letterhead */}
        <div className="flex items-start justify-between pb-4 mb-5" style={{ borderBottom: "2px solid var(--brand)" }}>
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <BrandMark size={18} />
              <span
                className="font-display text-[12.5px] font-semibold"
                style={{ color: "var(--brand)", letterSpacing: "0.08em" }}
              >
                VOYANTIX
              </span>
            </div>
            <div className="font-display text-[22px] font-bold" style={{ color: "var(--ink)" }}>
              Laytime Statement
            </div>
            <div className="text-[13px] mt-0.5" style={muted}>
              {doc.vesselName} · Voyage {doc.voyageReference}
            </div>
          </div>
          <StatusBadge tone={doc.status === "finalized" ? "brass" : "neutral"}>
            {doc.status === "finalized" ? "Finalized" : "Draft"}
          </StatusBadge>
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
                    {s.balanceSeconds === null ? "—" : formatDurationSeconds(s.balanceSeconds)}
                  </td>
                  <td
                    className={`${cell} num`}
                    style={{
                      textAlign: "right",
                      color:
                        s.settlementKind === "demurrage"
                          ? "var(--rust)"
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

        {/* Footer */}
        <div className="text-[11px] mt-6 pt-3" style={{ ...muted, borderTop: "1px solid var(--line)" }}>
          {doc.status === "finalized" && doc.finalizedAt
            ? `Finalized ${formatInstant(new Date(doc.finalizedAt), "UTC")} UTC. Amounts are in the charterparty's currency.`
            : "DRAFT — not yet finalized. Figures may change until the statement is finalized."}
        </div>
      </div>
    </div>
  );
}
