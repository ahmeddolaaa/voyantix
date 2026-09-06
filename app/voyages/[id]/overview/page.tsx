import { VoyagePageShell, getVoyage } from "@/components/VoyagePageShell";
import { Card, PageTitle, KpiCard, StatusBadge, SectionHeading } from "@/components/ui";
import { getStatementView } from "@/lib/actions/voyages";

export default async function VoyageOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const voyage = await getVoyage(id);
  if (!voyage) return null;

  const { canonical } = await getStatementView(id);

  const demurrage =
    canonical.kind === "found" && canonical.statement.settlementType === "Demurrage"
      ? canonical.statement.settlementAmountUsd
      : 0;
  const despatch =
    canonical.kind === "found" && canonical.statement.settlementType === "Despatch"
      ? canonical.statement.settlementAmountUsd
      : 0;

  return (
    <VoyagePageShell voyageId={id} active="overview">
      <div className="flex items-center justify-between mb-1">
        <PageTitle>{voyage.voyageReference}</PageTitle>
        <StatusBadge tone={voyage.status === "Cargo Complete" ? "teal" : "brass"}>
          {voyage.status}
        </StatusBadge>
      </div>
      <p className="text-[13px] mb-6" style={{ color: "var(--steel)" }}>
        {voyage.vesselName} · {voyage.portName}
      </p>

      <div className="grid grid-cols-2 gap-4 mb-6 max-w-xl">
        <KpiCard
          tone="rust"
          label="Demurrage Exposure"
          value={demurrage ? `$${demurrage.toLocaleString()}` : "–"}
          note={canonical.kind === "found" ? "Finalized statement" : "No finalized statement"}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 3v12M12 15l-4-4M12 15l4-4" />
              <path d="M4 20h16" />
            </svg>
          }
        />
        <KpiCard
          tone="teal"
          label="Despatch Recoverable"
          value={despatch ? `$${despatch.toLocaleString()}` : "–"}
          note={canonical.kind === "found" ? "Finalized statement" : "No finalized statement"}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 21V9M12 9l-4 4M12 9l4 4" />
              <path d="M4 4h16" />
            </svg>
          }
        />
      </div>

      <Card className="max-w-xl">
        <SectionHeading>Voyage Timing</SectionHeading>
        <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
          <dt style={{ color: "var(--steel)" }}>Arrival Time</dt>
          <dd className="num">{fmt(voyage.arrivalTime)}</dd>
          <dt style={{ color: "var(--steel)" }}>NOR Tender</dt>
          <dd className="num">{fmt(voyage.norTender)}</dd>
          <dt style={{ color: "var(--steel)" }}>NOR Acceptance</dt>
          <dd className="num">{fmt(voyage.norAcceptance)}</dd>
          <dt style={{ color: "var(--steel)" }}>Sailing Time</dt>
          <dd className="num">{fmt(voyage.sailingTime)}</dd>
        </dl>
      </Card>
    </VoyagePageShell>
  );
}

function fmt(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}
