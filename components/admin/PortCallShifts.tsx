"use client";

import { useState, useTransition } from "react";
import {
  createShiftPerformance,
  updateShiftPerformance,
  deleteShiftPerformance,
  type ShiftPerformanceRow,
} from "@/lib/actions/shift-performances";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import { SecondaryButton, DangerButton } from "@/components/ui";

/**
 * Shift performance for one port call.
 *
 * Throughput only. Nothing here implies anything about laytime: a shift
 * that moved 2,000 tonnes and a shift that moved none are both just
 * records of what happened (F24). The engine reads them to tell whether
 * work occurred in a window, never to decide how long laytime ran.
 */

type CargoOption = { id: string; name: string; status: "active" | "inactive" };
type FacilityOption = { id: string; name: string; status: "active" | "inactive" };

type FormState = {
  cargoId: string;
  facilityId: string;
  shiftDate: string;
  crane: string;
  quantityMt: string;
};

const emptyForm: FormState = {
  cargoId: "",
  facilityId: "",
  shiftDate: "",
  crane: "",
  quantityMt: "",
};

const selectStyle = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
} as const;

const selectClass =
  "w-full px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]";

export function PortCallShifts({
  portCallId,
  portCallFunction,
  initialShifts,
  cargoes,
  facilities,
}: {
  portCallId: string;
  /** LOAD or DISCHARGE, taken from the port call. */
  portCallFunction: string;
  initialShifts: ShiftPerformanceRow[];
  /** Only the cargoes actually planned for THIS port call. */
  cargoes: CargoOption[];
  facilities: FacilityOption[];
}) {
  const [rows, setRows] = useState(initialShifts);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftPerformanceRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cargoName = (id: string) =>
    cargoes.find((c) => c.id === id)?.name ?? "Unknown cargo";

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(r: ShiftPerformanceRow) {
    setEditing(r);
    setForm({
      cargoId: r.cargoId,
      facilityId: r.facilityId ?? "",
      shiftDate: r.shiftDate,
      crane: r.crane ?? "",
      quantityMt: r.quantityMt,
    });
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const input = {
        cargoId: form.cargoId,
        facilityId: form.facilityId || null,
        shiftDate: form.shiftDate,
        crane: form.crane || null,
        // The operation is the port call's own function — a load call only
        // ever has loading shifts, so asking again would just be a second
        // place for the same fact to go wrong.
        operationType: portCallFunction,
        quantityMt: form.quantityMt,
      };

      const result = editing
        ? await updateShiftPerformance(editing.id, input)
        : await createShiftPerformance(portCallId, input);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const saved: ShiftPerformanceRow = {
        id: editing ? editing.id : result.data.id,
        portCallId,
        cargoId: input.cargoId,
        facilityId: input.facilityId,
        shiftDate: input.shiftDate,
        crane: input.crane,
        operationType: input.operationType,
        quantityMt: input.quantityMt,
        recordedByUserId: editing?.recordedByUserId ?? "",
      };

      setRows((prev) =>
        editing ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]
      );
      closeForm();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const r = await deleteShiftPerformance(id);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setRows((prev) => prev.filter((x) => x.id !== id));
    });
  }

  const sorted = [...rows].sort((a, b) => a.shiftDate.localeCompare(b.shiftDate));

  return (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[12.5px]"
          style={{ fontWeight: 500, color: "var(--ink-soft)" }}
        >
          Shift performance
        </span>
        {!formOpen && (
          <SecondaryButton
            onClick={openCreate}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Add shift
          </SecondaryButton>
        )}
      </div>

      {rows.length === 0 && !formOpen && (
        <p className="text-[12.5px]" style={{ color: "var(--steel)" }}>
          {cargoes.length === 0
            ? "Add a cargo plan first — a shift records how much of a planned cargo moved."
            : "No shifts recorded yet."}
        </p>
      )}

      {sorted.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between py-1.5 text-[13px]"
        >
          <span>
            <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {r.shiftDate}
            </span>{" "}
            · {cargoName(r.cargoId)}
            <span style={{ color: "var(--steel)" }}>
              {" "}
              · {r.quantityMt} MT
              {r.crane ? ` · ${r.crane}` : ""}
            </span>
          </span>
          <span className="inline-flex gap-2">
            <SecondaryButton
              onClick={() => openEdit(r)}
              disabled={pending}
              className="!px-2 !py-0.5 !text-[11.5px]"
            >
              Edit
            </SecondaryButton>
            <DangerButton
              onClick={() => remove(r.id)}
              disabled={pending}
              className="!px-2 !py-0.5 !text-[11.5px]"
            >
              Remove
            </DangerButton>
          </span>
        </div>
      ))}

      {formOpen && (
        <div className="mt-3 p-3 rounded-md" style={{ background: "var(--bg)" }}>
          <FormError message={error} />
          <div className="grid md:grid-cols-3 gap-x-4">
            <Field label="Shift date" required>
              {(a) => (
                <TextInput
                  {...a}
                  type="date"
                  value={form.shiftDate}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, shiftDate: e.target.value }))
                  }
                />
              )}
            </Field>

            <Field label="Cargo" required>
              {(a) => (
                <select
                  {...a}
                  value={form.cargoId}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cargoId: e.target.value }))
                  }
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="">Select a cargo</option>
                  {cargoes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="Quantity (MT)" required>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.quantityMt}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, quantityMt: e.target.value }))
                  }
                  placeholder="e.g. 1850"
                />
              )}
            </Field>

            <Field label="Crane">
              {(a) => (
                <TextInput
                  {...a}
                  value={form.crane}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, crane: e.target.value }))
                  }
                  placeholder="e.g. Crane 2"
                />
              )}
            </Field>

            <Field label="Facility" description="Optional">
              {(a) => (
                <select
                  {...a}
                  value={form.facilityId}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, facilityId: e.target.value }))
                  }
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="">None</option>
                  {facilities
                    .filter(
                      (f) => f.status === "active" || f.id === form.facilityId
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
          </div>

          <div className="flex gap-2 mt-1">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save shift" : "Add shift"}
            </SubmitButton>
            <SecondaryButton onClick={closeForm} disabled={pending}>
              Cancel
            </SecondaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
