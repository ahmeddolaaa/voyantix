import { notFound } from "next/navigation";
import { getVoyage } from "@/lib/actions/voyages";
import { listVoyagePortCalls } from "@/lib/actions/voyage-port-calls";
import { listCargoPlans } from "@/lib/actions/cargo-plans";
import { listStoppages, type StoppageRow } from "@/lib/actions/stoppages";
import {
  listOperationalEvents,
  type OperationalEventRow,
} from "@/lib/actions/operational-events";
import {
  listShiftPerformances,
  type ShiftPerformanceRow,
} from "@/lib/actions/shift-performances";
import { listStoppageReasons } from "@/lib/actions/stoppage-reasons";
import { listEventTypes } from "@/lib/actions/event-types";
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
  const [portCalls, ports, facilities, cargoes, reasons, eventTypes] =
    await Promise.all([
      listVoyagePortCalls(id),
      listPorts({ includeInactive: true }),
      listFacilities({ includeInactive: true }),
      listCargoes({ includeInactive: true }),
      listStoppageReasons({ includeInactive: true }),
      listEventTypes({ includeInactive: true }),
    ]);

  const calls = portCalls.ok ? portCalls.data : [];

  // Cargo plans hang off individual port calls, and there is no "all plans
  // for a voyage" action, so compose the per-call one.
  const planLists = await Promise.all(calls.map((c) => listCargoPlans(c.id)));
  const stoppageLists = await Promise.all(calls.map((c) => listStoppages(c.id)));
  const eventLists = await Promise.all(
    calls.map((c) => listOperationalEvents(c.id))
  );
  const shiftLists = await Promise.all(
    calls.map((c) => listShiftPerformances(c.id))
  );
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

  // The operational lists are passed through as-is: their row types already
  // match what the port-call sections expect.
  const stoppagesByPortCall: Record<string, StoppageRow[]> = {};
  const eventsByPortCall: Record<string, OperationalEventRow[]> = {};
  const shiftsByPortCall: Record<string, ShiftPerformanceRow[]> = {};
  calls.forEach((c, i) => {
    stoppagesByPortCall[c.id] = stoppageLists[i].ok ? stoppageLists[i].data : [];
    eventsByPortCall[c.id] = eventLists[i].ok ? eventLists[i].data : [];
    shiftsByPortCall[c.id] = shiftLists[i].ok ? shiftLists[i].data : [];
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
      initialStoppagesByPortCall={stoppagesByPortCall}
      initialEventsByPortCall={eventsByPortCall}
      initialShiftsByPortCall={shiftsByPortCall}
      stoppageReasons={
        reasons.ok
          ? reasons.data.map((r) => ({
              id: r.id,
              name: r.name,
              status: r.status,
            }))
          : []
      }
      eventTypes={
        eventTypes.ok
          ? eventTypes.data.map((t) => ({
              id: t.id,
              label: t.label,
              systemSemantic: t.systemSemantic,
              status: t.status,
            }))
          : []
      }
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
              label:
                t.allowanceBasis === "RATE"
                  ? `${t.function} · ${t.allowanceRate} MT/day`
                  : `${t.function} · ${t.allowance} ${t.allowanceUnit}`,
              portId: t.portId,
              cargoId: t.cargoId,
              laytimeEndEvent: t.laytimeEndEvent,
            }))
          : []
      }
    />
  );
}
