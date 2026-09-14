import { notFound } from "next/navigation";
import { getVoyage } from "@/lib/actions/voyages";
import { listVoyagePortCalls } from "@/lib/actions/voyage-port-calls";
import { listCargoPlans } from "@/lib/actions/cargo-plans";
import { listContractLaytimeTerms } from "@/lib/actions/contract-laytime-terms";
import { listPorts } from "@/lib/actions/ports";
import { listFacilities } from "@/lib/actions/facilities";
import { listCargoes } from "@/lib/actions/cargoes";
import { VoyageDetailScreen } from "@/components/admin/VoyageDetailScreen";

export default async function VoyageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const voyage = await getVoyage(id);
  if (!voyage.ok) {
    if (voyage.code === "NOT_FOUND") notFound();
    return (
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div
          role="alert"
          className="rounded-md px-4 py-3 text-[13px]"
          style={{
            background: "var(--rust-soft)",
            border: "1px solid var(--rust)",
            color: "var(--rust)",
          }}
        >
          {voyage.message}
        </div>
      </div>
    );
  }

  // Ports, facilities and cargoes load WITH inactive rows so a port call that
  // references a since-deactivated one still shows its real name; the screen
  // offers only active ones as new choices.
  const [portCalls, ports, facilities, cargoes] = await Promise.all([
    listVoyagePortCalls(id),
    listPorts({ includeInactive: true }),
    listFacilities({ includeInactive: true }),
    listCargoes({ includeInactive: true }),
  ]);

  const calls = portCalls.ok ? portCalls.data : [];

  // Cargo plans hang off individual port calls, and there is no "all plans
  // for a voyage" action, so compose the per-call one.
  const planLists = await Promise.all(calls.map((c) => listCargoPlans(c.id)));
  const plansByPortCall: Record<string, {
    id: string;
    cargoId: string;
    plannedQuantityMt: string;
    actualQuantityMt: string | null;
  }[]> = {};
  calls.forEach((c, i) => {
    const list = planLists[i];
    plansByPortCall[c.id] = list.ok
      ? list.data.map((p) => ({
          id: p.id,
          cargoId: p.cargoId,
          plannedQuantityMt: p.plannedQuantityMt,
          actualQuantityMt: p.actualQuantityMt,
        }))
      : [];
  });

  // Term options exist only when the voyage carries a contract (PO11 scope).
  const terms = voyage.data.contractId
    ? await listContractLaytimeTerms(voyage.data.contractId, {
        includeInactive: true,
      })
    : null;

  return (
    <VoyageDetailScreen
      voyageId={id}
      voyageReference={voyage.data.voyageReference}
      vesselName={voyage.data.vesselName}
      contractId={voyage.data.contractId}
      status={voyage.data.status}
      initialPortCalls={calls}
      initialPlansByPortCall={plansByPortCall}
      ports={
        ports.ok
          ? ports.data.map((p) => ({
              id: p.id,
              name: p.name,
              defaultTimezone: p.defaultTimezone,
              status: p.status,
            }))
          : []
      }
      facilities={
        facilities.ok
          ? facilities.data.map((f) => ({
              id: f.id,
              name: f.name,
              portId: f.portId,
              status: f.status,
            }))
          : []
      }
      cargoes={
        cargoes.ok
          ? cargoes.data.map((c) => ({
              id: c.id,
              name: c.name,
              status: c.status,
            }))
          : []
      }
      termOptions={
        terms && terms.ok
          ? terms.data.map((t) => ({
              id: t.id,
              label: `${t.function} · ${t.allowance} ${t.allowanceUnit}`,
              portId: t.portId,
              cargoId: t.cargoId,
            }))
          : []
      }
    />
  );
}
