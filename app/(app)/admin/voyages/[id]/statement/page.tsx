import { notFound } from "next/navigation";
import { getVoyage } from "@/lib/actions/voyages";
import { getContract } from "@/lib/actions/contracts";
import { listVoyagePortCalls } from "@/lib/actions/voyage-port-calls";
import { listPorts } from "@/lib/actions/ports";
import { getStatement } from "@/lib/actions/laytime-statements";
import { getPortCallCalculation } from "@/lib/actions/laytime-calculations";
import { getPortCallSheet } from "@/lib/actions/port-call-sheet";
import {
  StatementDocument,
  type StatementDoc,
  type DocScope,
  type DocSheet,
} from "@/components/admin/StatementDocument";
import { EmptyState } from "@/components/ui";
import Link from "next/link";
import { getTenantContext } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";

/**
 * Printable statement document for a voyage. A server component: it gathers
 * the persisted statement, each scope's calculation, and the fixture header,
 * then hands a flat, serialisable document to the client for display + print.
 */
export default async function StatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const voyage = await getVoyage(id);
  if (!voyage.ok) {
    if (voyage.code === "NOT_FOUND") notFound();
    return <div className="max-w-4xl mx-auto px-8 py-8 text-[13px]">{voyage.message}</div>;
  }

  const [statement, portCalls, ports, contract] = await Promise.all([
    getStatement(id),
    listVoyagePortCalls(id),
    listPorts({ includeInactive: true }),
    voyage.data.contractId ? getContract(voyage.data.contractId) : Promise.resolve(null),
  ]);

  if (!statement.ok) {
    return <div className="max-w-4xl mx-auto px-8 py-8 text-[13px]">{statement.message}</div>;
  }

  if (!statement.data) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <Link href={`/admin/voyages/${id}`} className="text-[13px] no-underline" style={{ color: "var(--brass)" }}>
          ← Back to voyage
        </Link>
        <div className="mt-4">
          <EmptyState
            title="No statement yet"
            description="Build a statement draft from the voyage page, then come back to view it as a document."
          />
        </div>
      </div>
    );
  }

  const portName = (portId: string) =>
    (ports.ok ? ports.data.find((p) => p.id === portId)?.name : undefined) ?? "Port";
  const callById = new Map(
    (portCalls.ok ? portCalls.data : []).map((c) => [c.id, c])
  );

  const scopes: DocScope[] = [];
  const sheets: DocSheet[] = [];
  for (const s of statement.data.scopes) {
    const call = s.portCallId ? callById.get(s.portCallId) : undefined;
    const label = call ? `${call.sequence} · ${portName(call.portId)}` : "Pool";
    const timeZone = call?.effectiveTimezone ?? "UTC";

    let allowedSeconds: number | null = null;
    let usedSeconds: number | null = null;
    let windowStart: Date | null = null;
    let windowEnd: Date | null = null;
    if (s.portCallId) {
      const calc = await getPortCallCalculation(s.portCallId);
      if (calc.ok && calc.data && calc.data.status === "calculated") {
        allowedSeconds = calc.data.allowedSeconds;
        usedSeconds = calc.data.usedSeconds;
        windowStart = calc.data.window?.start ?? null;
        windowEnd = calc.data.window?.end ?? null;
      }
    }

    // The detailed sheet, only when it is the very calculation this statement
    // line was built from — never a later recalculation under an older figure.
    if (s.portCallId && (s.settlementKind === "demurrage" || s.settlementKind === "despatch" || s.settlementKind === "none")) {
      const sheet = await getPortCallSheet(s.portCallId);
      if (sheet.ok && sheet.data && sheet.data.calculationId === s.calculationId) {
        sheets.push({ title: label, sheet: sheet.data, note: null });
      } else {
        sheets.push({
          title: label,
          sheet: null,
          note: "The detailed time-sheet is not shown: this port call was recalculated after the statement was built. Rebuild the draft to include it.",
        });
      }
    }

    scopes.push({
      label,
      timeZone,
      outcome: s.balanceOutcome,
      allowedSeconds,
      usedSeconds,
      balanceSeconds: s.balanceSeconds,
      windowStart,
      windowEnd,
      settlementKind: s.settlementKind,
      amount: s.amount,
      note: s.settlementRefusalCode,
    });
  }

  const ctx = await getTenantContext();
  const d = statement.data.finalizedAt ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const doc: StatementDoc = {
    voyageId: id,
    issuer: ctx?.organizationName ?? "",
    preparedOn: `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    outdated: statement.data.outdated,
    unresolvedCount: statement.data.unresolvedCount,
    canFinalize: ctx ? hasPermission(ctx, "statement.finalize") : false,
    voyageReference: voyage.data.voyageReference,
    vesselName: voyage.data.vesselName,
    counterparty: contract && contract.ok ? contract.data.counterparty : null,
    contractReference: contract && contract.ok ? contract.data.reference : null,
    status: statement.data.status,
    finalizedAt: statement.data.finalizedAt,
    demurrageTotal: statement.data.demurrageTotal,
    despatchTotal: statement.data.despatchTotal,
    adjustmentsTotal: statement.data.adjustmentsTotal,
    netClaim: statement.data.netClaim,
    adjustments: statement.data.adjustments.map((a) => ({ amount: a.amount, reason: a.reason })),
    scopes,
    sheets,
  };

  return <StatementDocument doc={doc} />;
}
