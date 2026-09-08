"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createPort,
  updatePort,
  setPortStatus,
  type PortRow,
} from "@/lib/actions/ports";
import type { CalendarOption } from "@/lib/actions/ports-support";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import {
  Field,
  TextInput,
  Select,
  FormError,
  SubmitButton,
} from "@/components/forms";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import {
  Card,
  PageTitle,
  SectionHeading,
  SecondaryButton,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

/**
 * PORTS ADMINISTRATION
 * ---------------------------------------------------------------------------
 * The screen owns query state (search, sort) and submission state; the
 * shared primitives render it. All persistence goes through the authorized
 * server actions, which validate, map errors and write the audit trail.
 *
 * Field-level errors are routed by the ActionResult CODE, never by matching
 * the message text — messages are presentation and may be reworded.
 *
 * There is no delete control. Ports deactivate; the hard-delete policy waits
 * until PortCall and Facility relationships exist to check usage honestly.
 * ---------------------------------------------------------------------------
 */

type FormState = {
  name: string;
  country: string;
  unlocode: string;
  defaultTimezone: string;
  defaultHolidayCalendarId: string;
};

const emptyForm: FormState = {
  name: "",
  country: "",
  unlocode: "",
  defaultTimezone: "",
  defaultHolidayCalendarId: "",
};

export function PortsScreen({
  initialPorts,
  calendars,
}: {
  initialPorts: PortRow[];
  calendars: CalendarOption[];
}) {
  const [ports, setPorts] = useState(initialPorts);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });

  const [editing, setEditing] = useState<PortRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = ports.filter((p) => {
      if (!showInactive && p.status === "inactive") return false;
      if (q === "") return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q) ||
        (p.unlocode ?? "").toLowerCase().includes(q) ||
        p.defaultTimezone.toLowerCase().includes(q)
      );
    });

    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof PortRow;
      const av = (a[key] ?? "") as string;
      const bv = (b[key] ?? "") as string;
      return av.localeCompare(bv) * dir;
    });
  }, [ports, search, showInactive, sort]);

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setFormError(null);
  }

  function openEdit(port: PortRow) {
    setEditing(port);
    setCreating(false);
    setForm({
      name: port.name,
      country: port.country,
      unlocode: port.unlocode ?? "",
      defaultTimezone: port.defaultTimezone,
      defaultHolidayCalendarId: port.defaultHolidayCalendarId ?? "",
    });
    setFieldErrors({});
    setFormError(null);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setFieldErrors({});
    setFormError(null);
  }

  /** Routes a failed ActionResult to the right place by CODE. */
  function applyFailure(code: string, message: string) {
    if (code === "INVALID_TIMEZONE") {
      setFieldErrors({ defaultTimezone: message });
      setFormError(null);
    } else if (code === "DUPLICATE_NAME") {
      setFieldErrors({ name: message });
      setFormError(null);
    } else if (code === "DUPLICATE_CODE") {
      setFieldErrors({ unlocode: message });
      setFormError(null);
    } else if (code === "VALIDATION_ERROR") {
      setFormError(message);
    } else {
      setFormError(message);
    }
  }

  function submit() {
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      const input = {
        name: form.name,
        country: form.country,
        unlocode: form.unlocode || null,
        defaultTimezone: form.defaultTimezone,
        defaultHolidayCalendarId: form.defaultHolidayCalendarId || null,
      };

      const result = editing
        ? await updatePort(editing.id, input)
        : await createPort(input);

      if (!result.ok) {
        applyFailure(result.code, result.message);
        return;
      }

      const calendarName =
        calendars.find((c) => c.id === form.defaultHolidayCalendarId)?.name ??
        null;

      const saved: PortRow = {
        id: result.data.id,
        name: form.name.trim(),
        country: form.country.trim(),
        unlocode: form.unlocode.trim() || null,
        // The server canonicalizes the timezone; reflect what was submitted
        // until the next load rather than guessing at the canonical form.
        defaultTimezone: form.defaultTimezone,
        status: editing?.status ?? "active",
        defaultHolidayCalendarId: form.defaultHolidayCalendarId || null,
        defaultHolidayCalendarName: calendarName,
      };

      setPorts((prev) =>
        editing
          ? prev.map((p) => (p.id === saved.id ? saved : p))
          : [...prev, saved]
      );
      closeForm();
    });
  }

  function toggleStatus(port: PortRow) {
    const next = port.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setPortStatus(port.id, next);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      if (result.data.changed) {
        setPorts((prev) =>
          prev.map((p) => (p.id === port.id ? { ...p, status: next } : p))
        );
      }
    });
  }

  const columns: Column<PortRow>[] = [
    {
      key: "name",
      header: "Port",
      sortable: true,
      render: (p) => <span style={{ fontWeight: 500 }}>{p.name}</span>,
    },
    {
      key: "unlocode",
      header: "UN/LOCODE",
      sortable: true,
      hideBelow: "lg",
      render: (p) =>
        p.unlocode ? (
          <span className="num">{p.unlocode}</span>
        ) : (
          <span style={{ color: "var(--steel)" }}>—</span>
        ),
    },
    {
      key: "country",
      header: "Country",
      sortable: true,
      hideBelow: "md",
      render: (p) => p.country,
    },
    {
      key: "defaultTimezone",
      header: "Timezone",
      sortable: true,
      render: (p) => <span className="num text-[12px]">{p.defaultTimezone}</span>,
    },
    {
      key: "calendar",
      header: "Holiday calendar",
      hideBelow: "lg",
      render: (p) =>
        p.defaultHolidayCalendarName ?? (
          <span style={{ color: "var(--steel)" }}>Not set</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <StatusBadge tone={p.status === "active" ? "teal" : "neutral"}>
          {p.status === "active" ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (p) => (
        <div className="inline-flex gap-2">
          <SecondaryButton
            onClick={() => openEdit(p)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Edit
          </SecondaryButton>
          <SecondaryButton
            onClick={() => toggleStatus(p)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            {p.status === "active" ? "Deactivate" : "Reactivate"}
          </SecondaryButton>
        </div>
      ),
    },
  ];

  const formOpen = creating || editing !== null;

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <PageTitle>Ports</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            Ports and their local time. The timezone here applies to new port
            calls; voyages already recorded keep the timezone they were
            created with.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add port
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit ${editing.name}` : "Add a port"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Port name" required error={fieldErrors.name}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.name}
                  disabled={pending}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>

            <Field label="Country" required error={fieldErrors.country}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.country}
                  disabled={pending}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              )}
            </Field>

            <Field
              label="UN/LOCODE"
              description="Optional. The five-character code, such as EGALY."
              error={fieldErrors.unlocode}
            >
              {(a) => (
                <TextInput
                  {...a}
                  value={form.unlocode}
                  disabled={pending}
                  onChange={(e) =>
                    setForm({ ...form, unlocode: e.target.value })
                  }
                />
              )}
            </Field>

            <Field
              label="Local timezone"
              required
              description="Used to work out local day boundaries for laytime."
              error={fieldErrors.defaultTimezone}
            >
              {(a) => (
                <TimezoneCombobox
                  id={a.id}
                  required={a.required}
                  aria-describedby={a["aria-describedby"]}
                  invalid={a["aria-invalid"]}
                  disabled={pending}
                  value={form.defaultTimezone}
                  onChange={(tz) =>
                    setForm({ ...form, defaultTimezone: tz })
                  }
                />
              )}
            </Field>

            <Field
              label="Default holiday calendar"
              description="Optional. A contract can specify its own calendar instead."
            >
              {(a) => (
                <Select
                  {...a}
                  value={form.defaultHolidayCalendarId}
                  disabled={pending}
                  placeholder="Not set"
                  options={calendars.map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      defaultHolidayCalendarId: e.target.value,
                    })
                  }
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add port"}
            </SubmitButton>
            <SecondaryButton onClick={closeForm} disabled={pending}>
              Cancel
            </SecondaryButton>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-3 mb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ports"
          aria-label="Search ports"
          className="px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            minWidth: "260px",
          }}
        />
        <label
          className="flex items-center gap-2 text-[12.5px]"
          style={{ color: "var(--ink-soft)" }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <span className="text-[12px] ml-auto" style={{ color: "var(--steel)" }}>
          {visible.length} of {ports.length}
        </span>
      </div>

      <DataTable
        caption="Ports configured for this organization"
        columns={columns}
        rows={visible}
        getRowId={(p) => p.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          ports.length === 0 ? (
            <EmptyState
              title="No ports yet"
              description="Add the ports your vessels call at. Each one needs a local timezone."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add port
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No ports match that search"
              description="Try a different name, country or timezone."
            />
          )
        }
      />
    </div>
  );
}
