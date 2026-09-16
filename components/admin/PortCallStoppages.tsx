"use client";

import { useState, useTransition } from "react";
import {
  createStoppage,
  updateStoppage,
  deleteStoppage,
  type StoppageRow,
} from "@/lib/actions/stoppages";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import { SecondaryButton, DangerButton, StatusBadge } from "@/components/ui";
import { formatInstant } from "@/lib/format";

/**
 * Stoppages for one port call.
 *
 * An open stoppage (no end time) is the normal way to record something
 * still happening, so the end field is deliberately optional — but only
 * one stoppage can be open at a time, and the server says so plainly when
 * a second is attempted. Leaving the end blank on an existing stoppage
 * reopens it.
 *
 * Times are entered and shown in the browser's local zone. The port call's
 * own effectiveTimezone is what the engine will classify against later;
 * the two are not necessarily the same, which is why the stored value is
 * an absolute instant rather than a wall-clock string.
 */

type ReasonOption = { id: string; name: string; status: "active" | "inactive" };

type FormState = {
  reasonId: string;
  startTime: string;
  endTime: string;
  notes: string;
};

const emptyForm: FormState = {
  reasonId: "",
  startTime: "",
  endTime: "",
  notes: "",
};

const selectStyle = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
} as const;

const selectClass =
  "w-full px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]";

/** Date -> the value a datetime-local input expects, in local time. */
function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function PortCallStoppages({
  portCallId,
  initialStoppages,
  reasons,
  timeZone,
}: {
  portCallId: string;
  initialStoppages: StoppageRow[];
  reasons: ReasonOption[];
  timeZone: string;
}) {
  const [rows, setRows] = useState(initialStoppages);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StoppageRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reasonName = (id: string) =>
    reasons.find((r) => r.id === id)?.name ?? "Unknown reason";

  const hasOpen = rows.some((r) => r.endTime === null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(r: StoppageRow) {
    setEditing(r);
    setForm({
      reasonId: r.reasonId,
      startTime: toInputValue(r.startTime),
      endTime: r.endTime ? toInputValue(r.endTime) : "",
      notes: r.notes ?? "",
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
      // datetime-local gives a local wall-clock string; new Date() reads it
      // in the browser's zone and toISOString sends the absolute instant.
      const start = form.startTime ? new Date(form.startTime) : null;
      const end = form.endTime ? new Date(form.endTime) : null;

      const input = {
        reasonId: form.reasonId,
        startTime: start ? start.toISOString() : "",
        endTime: end ? end.toISOString() : null,
        notes: form.notes || null,
      };

      const result = editing
        ? await updateStoppage(editing.id, input)
        : await createStoppage(portCallId, input);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const saved: StoppageRow = {
        id: editing ? editing.id : result.data.id,
        portCallId,
        reasonId: input.reasonId,
        startTime: start as Date,
        endTime: end,
        notes: input.notes,
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
      const r = await deleteStoppage(id);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setRows((prev) => prev.filter((x) => x.id !== id));
    });
  }

  const sorted = [...rows].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );

  return (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[12.5px]"
          style={{ fontWeight: 500, color: "var(--ink-soft)" }}
        >
          Stoppages
        </span>
        {!formOpen && (
          <SecondaryButton
            onClick={openCreate}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Add stoppage
          </SecondaryButton>
        )}
      </div>

      {!formOpen && error && <FormError message={error} />}

      {rows.length === 0 && !formOpen && (
        <p className="text-[12.5px]" style={{ color: "var(--steel)" }}>
          No stoppages recorded yet.
        </p>
      )}

      {sorted.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between py-1.5 text-[13px]"
        >
          <span>
            {reasonName(r.reasonId)}
            <span style={{ color: "var(--steel)" }}>
              {" "}
              · {formatInstant(r.startTime, timeZone)} →{" "}
              {r.endTime ? formatInstant(r.endTime, timeZone) : "—"}
              {r.notes ? ` · ${r.notes}` : ""}
            </span>
            {r.endTime === null && (
              <span className="ml-2">
                <StatusBadge tone="teal">Open</StatusBadge>
              </span>
            )}
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
          <div className="grid md:grid-cols-2 gap-x-4">
            <Field label="Reason" required>
              {(a) => (
                <select
                  {...a}
                  value={form.reasonId}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reasonId: e.target.value }))
                  }
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="">Select a reason</option>
                  {reasons
                    .filter((x) => x.status === "active" || x.id === form.reasonId)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.status === "inactive" ? " — inactive" : ""}
                      </option>
                    ))}
                </select>
              )}
            </Field>

            <Field label="Notes">
              {(a) => (
                <TextInput
                  {...a}
                  value={form.notes}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              )}
            </Field>

            <Field label="Started" required>
              {(a) => (
                <TextInput
                  {...a}
                  type="datetime-local"
                  value={form.startTime}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, startTime: e.target.value }))
                  }
                />
              )}
            </Field>

            <Field
              label="Ended"
              description={
                editing
                  ? "Clear this to reopen the stoppage"
                  : hasOpen
                    ? "This port call already has an open stoppage"
                    : "Leave blank while the stoppage is still running"
              }
            >
              {(a) => (
                <TextInput
                  {...a}
                  type="datetime-local"
                  value={form.endTime}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, endTime: e.target.value }))
                  }
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-1">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save stoppage" : "Add stoppage"}
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
