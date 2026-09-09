"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createEventType,
  updateEventType,
  setEventTypeStatus,
  type EventTypeRow,
} from "@/lib/actions/event-types";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import {
  Card,
  PageTitle,
  SectionHeading,
  SecondaryButton,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

type FormState = { code: string; label: string };
const emptyForm: FormState = { code: "", label: "" };

export function EventTypesScreen({
  initialEventTypes,
}: {
  initialEventTypes: EventTypeRow[];
}) {
  const [rows, setRows] = useState(initialEventTypes);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [sort, setSort] = useState<SortState>({
    key: "displayOrder",
    direction: "asc",
  });

  const [editing, setEditing] = useState<EventTypeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The row currently being edited, if it is a protected/system row. Its
  // code is immutable, so the form renders code read-only and sends only
  // the label.
  const editingProtected = editing?.isProtected === true;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (!showInactive && r.status === "inactive") return false;
      if (q === "") return true;
      return (
        r.code.toLowerCase().includes(q) || r.label.toLowerCase().includes(q)
      );
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof EventTypeRow;
      if (key === "displayOrder") {
        return (a.displayOrder - b.displayOrder) * dir;
      }
      const av = (a[key] ?? "") as string;
      const bv = (b[key] ?? "") as string;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, search, showInactive, sort]);

  function updateField(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setFormError(null);
  }

  function openEdit(r: EventTypeRow) {
    setEditing(r);
    setCreating(false);
    setForm({ code: r.code, label: r.label });
    setFieldErrors({});
    setFormError(null);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setFieldErrors({});
    setFormError(null);
  }

  function submit() {
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      // For a protected row the code is immutable; send the existing code
      // unchanged so the input shape is satisfied, but the action ignores
      // it and writes only the label.
      const input = editing
        ? editingProtected
          ? { code: editing.code, label: form.label }
          : { code: form.code, label: form.label }
        : { code: form.code, label: form.label };

      const result = editing
        ? await updateEventType(editing.id, input)
        : await createEventType(input);

      if (!result.ok) {
        if (result.code === "DUPLICATE_CODE") {
          setFieldErrors({ code: result.message });
        } else if (result.code === "VALIDATION_ERROR") {
          setFormError(result.message);
        } else {
          setFormError(result.message);
        }
        return;
      }

      const saved: EventTypeRow = editing
        ? {
            ...editing,
            code: editingProtected ? editing.code : form.code.trim(),
            label: form.label.trim(),
          }
        : {
            id: result.data.id,
            code: form.code.trim(),
            label: form.label.trim(),
            systemSemantic: null,
            isProtected: false,
            displayOrder: 1000,
            status: "active",
          };

      setRows((prev) =>
        editing
          ? prev.map((r) => (r.id === saved.id ? saved : r))
          : [...prev, saved]
      );
      closeForm();
    });
  }

  function toggleStatus(r: EventTypeRow) {
    // Protected rows never reach here — the control is not rendered for
    // them — but guard anyway so an accidental call is a no-op.
    if (r.isProtected) return;
    const next = r.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setEventTypeStatus(r.id, next);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      if (result.data.changed) {
        setRows((prev) =>
          prev.map((x) => (x.id === r.id ? { ...x, status: next } : x))
        );
      }
    });
  }

  const columns: Column<EventTypeRow>[] = [
    {
      key: "code",
      header: "Code",
      sortable: true,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px" }}>
          {r.code}
        </span>
      ),
    },
    {
      key: "label",
      header: "Label",
      sortable: true,
      render: (r) => <span style={{ fontWeight: 500 }}>{r.label}</span>,
    },
    {
      key: "isProtected",
      header: "Kind",
      hideBelow: "md",
      render: (r) =>
        r.isProtected ? (
          <StatusBadge tone="brass">System</StatusBadge>
        ) : (
          <span style={{ color: "var(--steel)" }}>Custom</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={r.status === "active" ? "teal" : "neutral"}>
          {r.status === "active" ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <div className="inline-flex gap-2">
          <SecondaryButton
            onClick={() => openEdit(r)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Edit
          </SecondaryButton>
          {!r.isProtected && (
            <SecondaryButton
              onClick={() => toggleStatus(r)}
              disabled={pending}
              className="!px-2.5 !py-1 !text-[12px]"
            >
              {r.status === "active" ? "Deactivate" : "Reactivate"}
            </SecondaryButton>
          )}
        </div>
      ),
    },
  ];

  const formOpen = creating || editing !== null;

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <PageTitle>Event types</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            The vocabulary of port-call events. System events drive the laytime
            engine — their label can be renamed, but they cannot be removed or
            deactivated.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add event type
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing
              ? `Edit ${editing.label}`
              : "Add a custom event type"}
          </SectionHeading>

          {editingProtected && (
            <p
              className="text-[12.5px] mb-3 -mt-1"
              style={{ color: "var(--steel)" }}
            >
              System event type — only the label can be changed. The code is
              fixed because the laytime engine resolves against it.
            </p>
          )}

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Code" required error={fieldErrors.code}>
              {(a) => (
                <TextInput
                  {...a}
                  value={editingProtected ? editing!.code : form.code}
                  disabled={pending || editingProtected}
                  onChange={(e) => updateField("code", e.target.value)}
                  placeholder="e.g. anchorage_waiting"
                />
              )}
            </Field>

            <Field label="Label" required error={fieldErrors.label}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.label}
                  disabled={pending}
                  onChange={(e) => updateField("label", e.target.value)}
                  placeholder="e.g. Anchorage Waiting"
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add event type"}
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
          placeholder="Search event types"
          aria-label="Search event types"
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
          {visible.length} of {rows.length}
        </span>
      </div>

      <DataTable
        caption="Operational event types for this organization"
        columns={columns}
        rows={visible}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No event types yet"
              description="System events are seeded automatically. Add custom events your operations record."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add event type
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No event type matches that search"
              description="Try a different code or label."
            />
          )
        }
      />
    </div>
  );
}