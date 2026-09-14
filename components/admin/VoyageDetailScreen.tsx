"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  createVoyagePortCall,
  updateVoyagePortCall,
  setVoyagePortCallStatus,
  resolveContractLaytimeTerm,
  overrideContractLaytimeTerm,
  type VoyagePortCallRow,
} from "@/lib/actions/voyage-port-calls";
import {
  createCargoPlan,
  updateCargoPlan,
  deleteCargoPlan,
} from "@/lib/actions/cargo-plans";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import {
  Card,
  PageTitle,
  SectionHeading,
  SecondaryButton,
  DangerButton,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

type PortCallStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";
type PortCallFunction = "LOAD" | "DISCHARGE";

type CargoPlanView = {
  id: string;
  cargoId: string;
  plannedQuantityMt: string;
  actualQuantityMt: string | null;
};

type PortOption = {
  id: string;
  name: string;
  defaultTimezone: string;
  status: "active" | "inactive";
};
type FacilityOption = {
  id: string;
  name: string;
  portId: string;
  status: "active" | "inactive";
};
type CargoOption = { id: string; name: string; status: "active" | "inactive" };
type TermOption = {
  id: string;
  label: string;
  portId: string | null;
  cargoId: string | null;
};

const STATUS_LABEL: Record<PortCallStatus, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * The seven PO11 states, rendered as one line of explanation each.
 *
 * "Not yet resolved" and "no term applies" both leave the column null, and
 * the product deliberately does not merge them: one means nobody has run
 * resolution, the other means it ran and found nothing. Showing the same
 * text for both would hide a real difference from the user.
 */
type ResolutionNote =
  | { kind: "idle" }
  | { kind: "resolved"; termId: string }
  | { kind: "zero" }
  | { kind: "error"; code: string; message: string };

const selectStyle = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
} as const;

const selectClass =
  "w-full px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]";

export function VoyageDetailScreen({
  voyageId,
  voyageReference,
  vesselName,
  contractId,
  status,
  initialPortCalls,
  initialPlansByPortCall,
  ports,
  facilities,
  cargoes,
  termOptions,
}: {
  voyageId: string;
  voyageReference: string;
  vesselName: string;
  contractId: string | null;
  status: string;
  initialPortCalls: VoyagePortCallRow[];
  initialPlansByPortCall: Record<string, CargoPlanView[]>;
  ports: PortOption[];
  facilities: FacilityOption[];
  cargoes: CargoOption[];
  termOptions: TermOption[];
}) {
  const [calls, setCalls] = useState(initialPortCalls);
  const [plans, setPlans] = useState(initialPlansByPortCall);
  const [pending, startTransition] = useTransition();

  // Port call form
  const [callFormOpen, setCallFormOpen] = useState(false);
  const [editingCall, setEditingCall] = useState<VoyagePortCallRow | null>(null);
  const [callForm, setCallForm] = useState({
    portId: "",
    facilityId: "",
    function: "LOAD" as PortCallFunction,
    sequence: "",
  });
  const [callError, setCallError] = useState<string | null>(null);

  // Cargo plan form — scoped to whichever port call is expanded
  const [planFormFor, setPlanFormFor] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<CargoPlanView | null>(null);
  const [planForm, setPlanForm] = useState({
    cargoId: "",
    plannedQuantityMt: "",
    actualQuantityMt: "",
  });
  const [planError, setPlanError] = useState<string | null>(null);

  // PO11 resolution feedback, per port call
  const [notes, setNotes] = useState<Record<string, ResolutionNote>>({});

  const portName = (id: string) =>
    ports.find((p) => p.id === id)?.name ?? "Unknown port";
  const facilityName = (id: string | null) =>
    id ? facilities.find((f) => f.id === id)?.name ?? "—" : "—";
  const cargoName = (id: string) =>
    cargoes.find((c) => c.id === id)?.name ?? "Unknown cargo";
  const termLabel = (id: string | null) =>
    id ? termOptions.find((t) => t.id === id)?.label ?? "Unknown term" : null;

  const sortedCalls = useMemo(
    () => [...calls].sort((a, b) => a.sequence - b.sequence),
    [calls]
  );

  const facilitiesForPort = (portId: string) =>
    facilities.filter((f) => f.portId === portId);

  function openCreateCall() {
    setEditingCall(null);
    setCallFormOpen(true);
    setCallForm({ portId: "", facilityId: "", function: "LOAD", sequence: "" });
    setCallError(null);
  }

  function openEditCall(c: VoyagePortCallRow) {
    setEditingCall(c);
    setCallFormOpen(true);
    setCallForm({
      portId: c.portId,
      facilityId: c.facilityId ?? "",
      function: c.function,
      sequence: String(c.sequence),
    });
    setCallError(null);
  }

  function closeCallForm() {
    setCallFormOpen(false);
    setEditingCall(null);
    setCallError(null);
  }

  function submitCall() {
    setCallError(null);
    startTransition(async () => {
      const input = {
        portId: callForm.portId,
        facilityId: callForm.facilityId || null,
        function: callForm.function,
        sequence: callForm.sequence ? Number(callForm.sequence) : null,
      };

      if (editingCall) {
        const r = await updateVoyagePortCall(editingCall.id, input);
        if (!r.ok) {
          setCallError(r.message);
          return;
        }
        setCalls((prev) =>
          prev.map((c) =>
            c.id === editingCall.id
              ? {
                  ...c,
                  portId: input.portId,
                  facilityId: input.facilityId,
                  function: input.function,
                  sequence: input.sequence ?? c.sequence,
                }
              : c
          )
        );
        closeCallForm();
        return;
      }

      const r = await createVoyagePortCall(voyageId, input);
      if (!r.ok) {
        setCallError(r.message);
        return;
      }
      setCalls((prev) => [
        ...prev,
        {
          id: r.data.id,
          voyageId,
          portId: input.portId,
          facilityId: input.facilityId,
          function: input.function,
          sequence: r.data.sequence,
          status: "ACTIVE",
          effectiveTimezone: r.data.effectiveTimezone,
          contractLaytimeTermId: null,
        },
      ]);
      setPlans((prev) => ({ ...prev, [r.data.id]: [] }));
      closeCallForm();
    });
  }

  function changeCallStatus(c: VoyagePortCallRow, next: PortCallStatus) {
    startTransition(async () => {
      const r = await setVoyagePortCallStatus(c.id, next);
      if (!r.ok) {
        setCallError(r.message);
        return;
      }
      if (r.data.changed) {
        setCalls((prev) =>
          prev.map((x) => (x.id === c.id ? { ...x, status: next } : x))
        );
      }
    });
  }

  function openCreatePlan(portCallId: string) {
    setPlanFormFor(portCallId);
    setEditingPlan(null);
    setPlanForm({ cargoId: "", plannedQuantityMt: "", actualQuantityMt: "" });
    setPlanError(null);
  }

  function openEditPlan(portCallId: string, p: CargoPlanView) {
    setPlanFormFor(portCallId);
    setEditingPlan(p);
    setPlanForm({
      cargoId: p.cargoId,
      plannedQuantityMt: p.plannedQuantityMt,
      actualQuantityMt: p.actualQuantityMt ?? "",
    });
    setPlanError(null);
  }

  function closePlanForm() {
    setPlanFormFor(null);
    setEditingPlan(null);
    setPlanError(null);
  }

  function submitPlan(portCallId: string) {
    setPlanError(null);
    startTransition(async () => {
      const input = {
        cargoId: planForm.cargoId,
        plannedQuantityMt: planForm.plannedQuantityMt,
        actualQuantityMt: planForm.actualQuantityMt || null,
      };

      if (editingPlan) {
        const r = await updateCargoPlan(editingPlan.id, input);
        if (!r.ok) {
          setPlanError(r.message);
          return;
        }
        setPlans((prev) => ({
          ...prev,
          [portCallId]: (prev[portCallId] ?? []).map((p) =>
            p.id === editingPlan.id ? { ...p, ...input } : p
          ),
        }));
        closePlanForm();
        return;
      }

      const r = await createCargoPlan(portCallId, input);
      if (!r.ok) {
        setPlanError(r.message);
        return;
      }
      setPlans((prev) => ({
        ...prev,
        [portCallId]: [...(prev[portCallId] ?? []), { id: r.data.id, ...input }],
      }));
      closePlanForm();
    });
  }

  function removePlan(portCallId: string, planId: string) {
    startTransition(async () => {
      const r = await deleteCargoPlan(planId);
      if (!r.ok) {
        setPlanError(r.message);
        return;
      }
      setPlans((prev) => ({
        ...prev,
        [portCallId]: (prev[portCallId] ?? []).filter((p) => p.id !== planId),
      }));
    });
  }

  function runResolve(portCallId: string) {
    startTransition(async () => {
      const r = await resolveContractLaytimeTerm(portCallId);
      if (!r.ok) {
        setNotes((n) => ({
          ...n,
          [portCallId]: { kind: "error", code: r.code, message: r.message },
        }));
        return;
      }
      const termId = r.data.contractLaytimeTermId;
      setNotes((n) => ({
        ...n,
        [portCallId]: termId ? { kind: "resolved", termId } : { kind: "zero" },
      }));
      setCalls((prev) =>
        prev.map((c) =>
          c.id === portCallId ? { ...c, contractLaytimeTermId: termId } : c
        )
      );
    });
  }

  function runOverride(portCallId: string, termId: string) {
    startTransition(async () => {
      const r = await overrideContractLaytimeTerm(portCallId, termId || null);
      if (!r.ok) {
        setNotes((n) => ({
          ...n,
          [portCallId]: { kind: "error", code: r.code, message: r.message },
        }));
        return;
      }
      setNotes((n) => ({ ...n, [portCallId]: { kind: "idle" } }));
      setCalls((prev) =>
        prev.map((c) =>
          c.id === portCallId
            ? { ...c, contractLaytimeTermId: r.data.contractLaytimeTermId }
            : c
        )
      );
    });
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="mb-6">
        <Link
          href="/admin/voyages"
          className="text-[12.5px] hover:underline"
          style={{ color: "var(--brass)" }}
        >
          ← All voyages
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <PageTitle>{voyageReference}</PageTitle>
            <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
              {vesselName}
              {contractId ? "" : " · no contract attached"}
            </p>
          </div>
          <StatusBadge tone={status === "ACTIVE" ? "teal" : "neutral"}>
            {status === "ACTIVE"
              ? "Active"
              : status === "COMPLETED"
                ? "Completed"
                : "Cancelled"}
          </StatusBadge>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <SectionHeading>Port calls</SectionHeading>
        {!callFormOpen && (
          <SubmitButton onClick={openCreateCall} pending={false}>
            Add port call
          </SubmitButton>
        )}
      </div>

      {callFormOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editingCall
              ? `Edit port call ${editingCall.sequence}`
              : "Add a port call"}
          </SectionHeading>

          <FormError message={callError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Port" required>
              {(a) => (
                <select
                  {...a}
                  value={callForm.portId}
                  disabled={pending}
                  onChange={(e) =>
                    setCallForm((f) => ({
                      ...f,
                      portId: e.target.value,
                      facilityId: "",
                    }))
                  }
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="">Select a port</option>
                  {ports
                    .filter(
                      (p) => p.status === "active" || p.id === callForm.portId
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.defaultTimezone})
                        {p.status === "inactive" ? " — inactive" : ""}
                      </option>
                    ))}
                </select>
              )}
            </Field>

            <Field label="Operation" required>
              {(a) => (
                <select
                  {...a}
                  value={callForm.function}
                  disabled={pending}
                  onChange={(e) =>
                    setCallForm((f) => ({
                      ...f,
                      function: e.target.value as PortCallFunction,
                    }))
                  }
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="LOAD">Load</option>
                  <option value="DISCHARGE">Discharge</option>
                </select>
              )}
            </Field>

            <Field
              label="Facility"
              description="Optional — a berth or terminal within the port"
            >
              {(a) => (
                <select
                  {...a}
                  value={callForm.facilityId}
                  disabled={pending || callForm.portId === ""}
                  onChange={(e) =>
                    setCallForm((f) => ({ ...f, facilityId: e.target.value }))
                  }
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="">None</option>
                  {facilitiesForPort(callForm.portId)
                    .filter(
                      (f) =>
                        f.status === "active" || f.id === callForm.facilityId
                    )
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                        {f.status === "inactive" ? " — inactive" : ""}
                      </option>
                    ))}
                </select>
              )}
            </Field>

            <Field
              label="Sequence"
              description={
                editingCall
                  ? "Visiting order within this voyage"
                  : "Leave blank to add after the last call"
              }
            >
              {(a) => (
                <TextInput
                  {...a}
                  type="number"
                  min={1}
                  value={callForm.sequence}
                  disabled={pending}
                  onChange={(e) =>
                    setCallForm((f) => ({ ...f, sequence: e.target.value }))
                  }
                  placeholder={editingCall ? "" : "Auto"}
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submitCall} pending={pending}>
              {editingCall ? "Save changes" : "Add port call"}
            </SubmitButton>
            <SecondaryButton onClick={closeCallForm} disabled={pending}>
              Cancel
            </SecondaryButton>
          </div>
        </Card>
      )}

      {sortedCalls.length === 0 && !callFormOpen && (
        <EmptyState
          title="No port calls yet"
          description="Add the first port this voyage visits. Each call captures its own local timezone."
          action={
            <SubmitButton onClick={openCreateCall} pending={false}>
              Add port call
            </SubmitButton>
          }
        />
      )}

      <div className="space-y-4">
        {sortedCalls.map((c) => {
          const callPlans = plans[c.id] ?? [];
          const note = notes[c.id];
          const currentTerm = termLabel(c.contractLaytimeTermId);

          return (
            <Card key={c.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[12px] px-2 py-0.5 rounded"
                      style={{
                        background: "var(--line)",
                        color: "var(--ink-soft)",
                      }}
                    >
                      {c.sequence}
                    </span>
                    <span style={{ fontWeight: 500 }}>{portName(c.portId)}</span>
                    <StatusBadge tone={c.function === "LOAD" ? "teal" : "neutral"}>
                      {c.function === "LOAD" ? "Load" : "Discharge"}
                    </StatusBadge>
                  </div>
                  <div
                    className="text-[12px] mt-1"
                    style={{ color: "var(--steel)" }}
                  >
                    {facilityName(c.facilityId)} · local time{" "}
                    {c.effectiveTimezone}
                  </div>
                </div>

                <div className="inline-flex gap-2 items-center">
                  <SecondaryButton
                    onClick={() => openEditCall(c)}
                    disabled={pending}
                    className="!px-2.5 !py-1 !text-[12px]"
                  >
                    Edit
                  </SecondaryButton>
                  <select
                    value={c.status}
                    disabled={pending}
                    onChange={(e) =>
                      changeCallStatus(c, e.target.value as PortCallStatus)
                    }
                    aria-label={`Status for port call ${c.sequence}`}
                    className="px-2 py-1 rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
                    style={selectStyle}
                  >
                    {(["ACTIVE", "COMPLETED", "CANCELLED"] as const).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                className="mt-4 pt-4"
                style={{ borderTop: "1px solid var(--line)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-[12.5px]"
                    style={{ fontWeight: 500, color: "var(--ink-soft)" }}
                  >
                    Cargo
                  </span>
                  {planFormFor !== c.id && (
                    <SecondaryButton
                      onClick={() => openCreatePlan(c.id)}
                      disabled={pending}
                      className="!px-2.5 !py-1 !text-[12px]"
                    >
                      Add cargo
                    </SecondaryButton>
                  )}
                </div>

                {callPlans.length === 0 && planFormFor !== c.id && (
                  <p className="text-[12.5px]" style={{ color: "var(--steel)" }}>
                    No cargo planned yet. A term cannot be resolved without one.
                  </p>
                )}

                {callPlans.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-1.5 text-[13px]"
                  >
                    <span>
                      {cargoName(p.cargoId)}
                      <span style={{ color: "var(--steel)" }}>
                        {" "}
                        · {p.plannedQuantityMt} MT planned
                        {p.actualQuantityMt
                          ? ` · ${p.actualQuantityMt} MT actual`
                          : ""}
                      </span>
                    </span>
                    <span className="inline-flex gap-2">
                      <SecondaryButton
                        onClick={() => openEditPlan(c.id, p)}
                        disabled={pending}
                        className="!px-2 !py-0.5 !text-[11.5px]"
                      >
                        Edit
                      </SecondaryButton>
                      <DangerButton
                        onClick={() => removePlan(c.id, p.id)}
                        disabled={pending}
                        className="!px-2 !py-0.5 !text-[11.5px]"
                      >
                        Remove
                      </DangerButton>
                    </span>
                  </div>
                ))}

                {planFormFor === c.id && (
                  <div
                    className="mt-3 p-3 rounded-md"
                    style={{ background: "var(--bg)" }}
                  >
                    <FormError message={planError} />
                    <div className="grid md:grid-cols-3 gap-x-4">
                      <Field label="Cargo" required>
                        {(a) => (
                          <select
                            {...a}
                            value={planForm.cargoId}
                            disabled={pending}
                            onChange={(e) =>
                              setPlanForm((f) => ({
                                ...f,
                                cargoId: e.target.value,
                              }))
                            }
                            className={selectClass}
                            style={selectStyle}
                          >
                            <option value="">Select a cargo</option>
                            {cargoes
                              .filter(
                                (x) =>
                                  x.status === "active" ||
                                  x.id === planForm.cargoId
                              )
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                  {x.status === "inactive" ? " — inactive" : ""}
                                </option>
                              ))}
                          </select>
                        )}
                      </Field>

                      <Field label="Planned MT" required>
                        {(a) => (
                          <TextInput
                            {...a}
                            value={planForm.plannedQuantityMt}
                            disabled={pending}
                            onChange={(e) =>
                              setPlanForm((f) => ({
                                ...f,
                                plannedQuantityMt: e.target.value,
                              }))
                            }
                            placeholder="e.g. 12500"
                          />
                        )}
                      </Field>

                      <Field
                        label="Actual MT"
                        description="Fill in once the operation is complete"
                      >
                        {(a) => (
                          <TextInput
                            {...a}
                            value={planForm.actualQuantityMt}
                            disabled={pending}
                            onChange={(e) =>
                              setPlanForm((f) => ({
                                ...f,
                                actualQuantityMt: e.target.value,
                              }))
                            }
                          />
                        )}
                      </Field>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <SubmitButton
                        onClick={() => submitPlan(c.id)}
                        pending={pending}
                      >
                        {editingPlan ? "Save cargo" : "Add cargo"}
                      </SubmitButton>
                      <SecondaryButton onClick={closePlanForm} disabled={pending}>
                        Cancel
                      </SecondaryButton>
                    </div>
                  </div>
                )}
              </div>

              <div
                className="mt-4 pt-4"
                style={{ borderTop: "1px solid var(--line)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-[12.5px]"
                    style={{ fontWeight: 500, color: "var(--ink-soft)" }}
                  >
                    Commercial term
                  </span>
                  <SecondaryButton
                    onClick={() => runResolve(c.id)}
                    disabled={pending || !contractId}
                    className="!px-2.5 !py-1 !text-[12px]"
                  >
                    Resolve term
                  </SecondaryButton>
                </div>

                <div className="text-[13px]">
                  {currentTerm ? (
                    <span>{currentTerm}</span>
                  ) : (
                    <span style={{ color: "var(--steel)" }}>
                      No term set. Resolve it, or choose one manually.
                    </span>
                  )}
                </div>

                {note && note.kind !== "idle" && (
                  <p
                    className="text-[12px] mt-2"
                    style={{
                      color:
                        note.kind === "error"
                          ? "var(--rust)"
                          : "var(--ink-soft)",
                    }}
                  >
                    {note.kind === "resolved" &&
                      "Resolved from the contract's terms."}
                    {note.kind === "zero" &&
                      "Resolution ran, but no term in this contract applies to this port call."}
                    {note.kind === "error" && note.message}
                  </p>
                )}

                {contractId && termOptions.length > 0 && (
                  <div className="mt-2">
                    <select
                      value={c.contractLaytimeTermId ?? ""}
                      disabled={pending}
                      onChange={(e) => runOverride(c.id, e.target.value)}
                      aria-label={`Override term for port call ${c.sequence}`}
                      className={selectClass}
                      style={selectStyle}
                    >
                      <option value="">No term</option>
                      {termOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <p
                      className="text-[11.5px] mt-1"
                      style={{ color: "var(--steel)" }}
                    >
                      Choosing here overrides the resolver and is recorded as a
                      manual decision.
                    </p>
                  </div>
                )}

                {!contractId && (
                  <p
                    className="text-[12px] mt-2"
                    style={{ color: "var(--steel)" }}
                  >
                    This voyage has no contract, so no term can be attached.
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
