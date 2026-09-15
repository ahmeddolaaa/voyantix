"use client";

import { useState, useTransition } from "react";
import {
  recordOperationalEvent,
  correctOperationalEvent,
  type OperationalEventRow,
} from "@/lib/actions/operational-events";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import { SecondaryButton, StatusBadge } from "@/components/ui";

/**
 * Operational events for one port call.
 *
 * There is no edit and no delete, because events are append-only: a
 * recorded event is what someone asserted at the time, and a statement may
 * later rest on it. Getting one wrong is fixed by recording a correction,
 * which leaves the original visible with a "corrected" marker rather than
 * erasing it.
 *
 * Superseded events stay on screen, greyed out. That is deliberate — the
 * value of an append-only log is lost if the interface hides the part that
 * was withdrawn.
 */

type EventTypeOption = {
  id: string;
  label: string;
  systemSemantic: string | null;
  status: "active" | "inactive";
};

type FormState = { eventTypeId: string; occurredAt: string };
const emptyForm: FormState = { eventTypeId: "", occurredAt: "" };

const selectStyle = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
} as const;

const selectClass =
  "w-full px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]";

function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatInstant(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PortCallEvents({
  portCallId,
  initialEvents,
  eventTypes,
}: {
  portCallId: string;
  initialEvents: OperationalEventRow[];
  eventTypes: EventTypeOption[];
}) {
  const [rows, setRows] = useState(initialEvents);
  const [formOpen, setFormOpen] = useState(false);
  /** When set, the form records a CORRECTION to this event rather than a new one. */
  const [correcting, setCorrecting] = useState<OperationalEventRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const typeLabel = (id: string) =>
    eventTypes.find((t) => t.id === id)?.label ?? "Unknown event";
  const typeSemantic = (id: string) =>
    eventTypes.find((t) => t.id === id)?.systemSemantic ?? null;

  function openRecord() {
    setCorrecting(null);
    setForm(emptyForm);
    setError(null);
    setFormOpen(true);
  }

  function openCorrect(r: OperationalEventRow) {
    setCorrecting(r);
    setForm({
      eventTypeId: r.eventTypeId,
      occurredAt: toInputValue(r.occurredAt),
    });
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setCorrecting(null);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const when = form.occurredAt ? new Date(form.occurredAt) : null;
      const input = {
        eventTypeId: form.eventTypeId,
        occurredAt: when ? when.toISOString() : "",
      };

      if (correcting) {
        const result = await correctOperationalEvent(correcting.id, input);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const replacement: OperationalEventRow = {
          id: result.data.id,
          portCallId,
          eventTypeId: input.eventTypeId,
          occurredAt: when as Date,
          recordedAt: new Date(),
          recordedByUserId: correcting.recordedByUserId,
          supersededByEventId: null,
        };
        setRows((prev) => [
          ...prev.map((x) =>
            x.id === correcting.id
              ? { ...x, supersededByEventId: result.data.id }
              : x
          ),
          replacement,
        ]);
        closeForm();
        return;
      }

      const result = await recordOperationalEvent(portCallId, input);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRows((prev) => [
        ...prev,
        {
          id: result.data.id,
          portCallId,
          eventTypeId: input.eventTypeId,
          occurredAt: when as Date,
          recordedAt: new Date(),
          recordedByUserId: "",
          supersededByEventId: null,
        },
      ]);
      closeForm();
    });
  }

  const sorted = [...rows].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
  );

  return (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[12.5px]"
          style={{ fontWeight: 500, color: "var(--ink-soft)" }}
        >
          Events
        </span>
        {!formOpen && (
          <SecondaryButton
            onClick={openRecord}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Record event
          </SecondaryButton>
        )}
      </div>

      {!formOpen && error && <FormError message={error} />}

      {rows.length === 0 && !formOpen && (
        <p className="text-[12.5px]" style={{ color: "var(--steel)" }}>
          No events recorded yet.
        </p>
      )}

      {sorted.map((r) => {
        const superseded = r.supersededByEventId !== null;
        const semantic = typeSemantic(r.eventTypeId);
        return (
          <div
            key={r.id}
            className="flex items-center justify-between py-1.5 text-[13px]"
            style={superseded ? { opacity: 0.55 } : undefined}
          >
            <span>
              <span
                style={
                  superseded
                    ? { textDecoration: "line-through" }
                    : { fontWeight: 500 }
                }
              >
                {typeLabel(r.eventTypeId)}
              </span>
              {semantic && (
                <span className="ml-2">
                  <StatusBadge tone="teal">{semantic}</StatusBadge>
                </span>
              )}
              <span style={{ color: "var(--steel)" }}>
                {" "}
                · {formatInstant(r.occurredAt)}
              </span>
              {superseded && (
                <span className="ml-2" style={{ color: "var(--steel)" }}>
                  — corrected
                </span>
              )}
            </span>
            {!superseded && (
              <SecondaryButton
                onClick={() => openCorrect(r)}
                disabled={pending}
                className="!px-2 !py-0.5 !text-[11.5px]"
              >
                Correct
              </SecondaryButton>
            )}
          </div>
        );
      })}

      {formOpen && (
        <div className="mt-3 p-3 rounded-md" style={{ background: "var(--bg)" }}>
          {correcting && (
            <p className="text-[12px] mb-2" style={{ color: "var(--ink-soft)" }}>
              Correcting {typeLabel(correcting.eventTypeId)} at{" "}
              {formatInstant(correcting.occurredAt)}. The original stays on
              record.
            </p>
          )}

          <FormError message={error} />

          <div className="grid md:grid-cols-2 gap-x-4">
            <Field label="Event" required>
              {(a) => (
                <select
                  {...a}
                  value={form.eventTypeId}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, eventTypeId: e.target.value }))
                  }
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="">Select an event</option>
                  {eventTypes
                    .filter(
                      (t) => t.status === "active" || t.id === form.eventTypeId
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                        {t.systemSemantic ? ` (${t.systemSemantic})` : ""}
                      </option>
                    ))}
                </select>
              )}
            </Field>

            <Field label="Occurred at" required>
              {(a) => (
                <TextInput
                  {...a}
                  type="datetime-local"
                  value={form.occurredAt}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, occurredAt: e.target.value }))
                  }
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-1">
            <SubmitButton onClick={submit} pending={pending}>
              {correcting ? "Record correction" : "Record event"}
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
