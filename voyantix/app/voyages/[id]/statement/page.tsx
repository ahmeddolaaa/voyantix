import { VoyagePageShell, getVoyage } from "@/components/VoyagePageShell";
import { Card, PageTitle, SectionHeading, StatusBadge, EmptyState } from "@/components/ui";
import { getStatementView } from "@/lib/actions/voyages";
import { RecalculateButton, FinalizeButton } from "@/components/StatementActions";
import { recalculateVoyageAction, finalizeStatement } from "@/lib/actions/voyages";

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const voyage = await getVoyage(id);
  if (!voyage) return null;

  const { canonical, draft, entries } = await getStatementView(id);

  async function recalc() {
    "use server";
    return recalculateVoyageAction(id);
  }

  async function finalize(statementId: string) {
    "use server";
    return finalizeStatement(id, statementId);
  }

  return (
    <VoyagePageShell voyageId={id} active="statement">
      <div className="flex items-start justify-between mb-1">
        <div>
          <PageTitle>Laytime Statement</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            {voyage.voyageReference} · {voyage.vesselName} · {voyage.portName}
          </p>
        </div>
        <div className="flex gap-2">
          <RecalculateButton action={recalc} />
          {draft.kind === "found" && canonical.kind === "none" && (
            <FinalizeButton action={finalize.bind(null, draft.statement.id)} />
          )}
        </div>
      </div>

      {/* --- Draft working state ------------------------------------------- */}
      <div className="mt-6 mb-8">
        <SectionHeading>Working draft</SectionHeading>
        {draft.kind === "none" && (
          <EmptyState
            title="No draft statement"
            description="Run a recalculation to produce a draft statement from the recorded stoppages."
          />
        )}
        {draft.kind === "conflict" && (
          <IntegrityException count={draft.count} label="draft statements" />
        )}
        {draft.kind === "found" && (
          <Card className="max-w-2xl">
            <div className="flex items-center gap-2 mb-4">
              <StatusBadge tone="neutral">Draft</StatusBadge>
              <span className="text-[12px]" style={{ color: "var(--steel)" }}>
                Updated {new Date(draft.statement.updatedAt ?? "").toLocaleString()}
              </span>
            </div>
            <Figures s={draft.statement} />
          </Card>
        )}
      </div>

      {/* --- Canonical commercial statement --------------------------------- */}
      <SectionHeading>Commercial statement</SectionHeading>

      {canonical.kind === "none" && (
        <EmptyState
          title="No finalized statement"
          description="This voyage has no commercially binding statement yet. Finalize the working draft once the figures are agreed."
        />
      )}

      {canonical.kind === "conflict" && (
        <IntegrityException count={canonical.count} label="finalized statements" />
      )}

      {canonical.kind === "found" && (
        <>
          <Card className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <StatusBadge tone="teal">Finalized</StatusBadge>
              <span className="text-[12px]" style={{ color: "var(--steel)" }}>
                {new Date(canonical.statement.updatedAt ?? "").toLocaleString()}
              </span>
            </div>
            <Figures s={canonical.statement} large />
          </Card>

          <SectionHeading>Time sheet</SectionHeading>
          {entries.length === 0 ? (
            <EmptyState title="No time sheet entries on this statement" />
          ) : (
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <Th>Start</Th>
                    <Th>End</Th>
                    <Th>Duration</Th>
                    <Th>State</Th>
                    <Th>Decision</Th>
                    <Th>Stoppage</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                      <td className="px-5 py-2.5 num">{new Date(e.startTime).toLocaleString()}</td>
                      <td className="px-5 py-2.5 num">{new Date(e.endTime).toLocaleString()}</td>
                      <td className="px-5 py-2.5 num">{e.durationHours.toFixed(2)} h</td>
                      <td className="px-5 py-2.5">
                        <StatusBadge tone={e.currentState === "On Demurrage" ? "rust" : "neutral"}>
                          {e.currentState}
                        </StatusBadge>
                      </td>
                      <td className="px-5 py-2.5">
                        <StatusBadge tone={e.countedOrExcluded === "Counted" ? "teal" : "neutral"}>
                          {e.countedOrExcluded}
                        </StatusBadge>
                      </td>
                      <td className="px-5 py-2.5" style={{ color: "var(--steel)" }}>
                        {e.reasonName ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </VoyagePageShell>
  );
}

function Figures({
  s,
  large = false,
}: {
  s: {
    laytimeAllowedDays: number;
    timeUsedDays: number;
    timeBalanceDays: number;
    settlementType: string;
    settlementAmountUsd: number;
  };
  large?: boolean;
}) {
  const isDemurrage = s.settlementType === "Demurrage";
  return (
    <dl className="grid grid-cols-2 gap-y-3 gap-x-8 max-w-lg text-[13px]">
      <dt style={{ color: "var(--steel)" }}>Laytime allowed</dt>
      <dd className="num">{s.laytimeAllowedDays.toFixed(2)} days</dd>
      <dt style={{ color: "var(--steel)" }}>Time used</dt>
      <dd className="num">{s.timeUsedDays.toFixed(2)} days</dd>
      <dt style={{ color: "var(--steel)" }}>Time balance</dt>
      <dd className="num" style={{ color: isDemurrage ? "var(--rust)" : "var(--teal)" }}>
        {s.timeBalanceDays.toFixed(2)} days
      </dd>
      <dt style={{ color: "var(--steel)" }}>{s.settlementType}</dt>
      <dd
        className={`num ${large ? "text-[20px]" : ""}`}
        style={{ color: isDemurrage ? "var(--rust)" : "var(--teal)", fontWeight: 500 }}
      >
        ${s.settlementAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </dd>
    </dl>
  );
}

function IntegrityException({ count, label }: { count: number; label: string }) {
  return (
    <div
      className="rounded-lg p-6"
      style={{ background: "var(--rust-soft)", border: "1px solid var(--rust)" }}
    >
      <div className="font-display text-[16px] mb-1" style={{ color: "var(--rust)" }}>
        Data integrity exception
      </div>
      <p className="text-[13px]" style={{ color: "var(--ink-soft)" }}>
        This voyage has {count} {label}. Voyantix will not choose one automatically, because
        picking arbitrarily could put the wrong figures in front of a counterparty. An
        administrator needs to resolve the duplicates before this statement can be used.
      </p>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left px-5 py-3 font-medium" style={{ color: "var(--steel)" }}>
      {children}
    </th>
  );
}
