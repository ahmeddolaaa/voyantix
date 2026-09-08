"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createStoppageReason,
  updateStoppageReason,
  setStoppageReasonStatus,
  type StoppageReasonRow,
} from "@/lib/actions/stoppage-reasons";
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

type FormState = { name: string; isWeatherRelated: boolean };
const emptyForm: FormState = { name: "", isWeatherRelated: false };

export function StoppageReasonsScreen({
  initialStoppageReasons,
}: {
  initialStoppageReasons: StoppageReasonRow[];
}) {
  const [rows, setRows] = useState(initialStoppageReasons);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });

  const [editing, setEditing] = useState<StoppageReasonRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (!showInactive && r.status === "inactive") return false;
      if (q === "") return true;
      return r.name.toLowerCase().includes(q);
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof StoppageReasonRow;
      const av = (a[key] ?? "") as string;
      const bv = (b[key] ?? "") as string;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, search, showInactive, sort]);

  function updateName(value: string) {
    setForm((f) => ({ ...f, name: value }));
    setFieldErrors((e) => {
      if (!e.name) return e;
      const next = { ...e };
      delete next.name;
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

  function openEdit(r: StoppageReasonRow) {
    setEditing(r);
    setCreating(false);
    setForm({ name: r.name, isWeatherRelated: r.isWeatherRelated });
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
      const input = { name: form.name, isWeatherRelated: form.isWeatherRelated };
      const result = editing
        ? await updateStoppageReason(editing.id, input)
        : await createStoppageReason(input);

      if (!result.ok) {
        if (result.code === "DUPLICATE_NAME") {
          setFieldErrors({ name: result.message });
        } else {
          setFormError(result.message);
        }
        return;
      }

      const saved: StoppageReasonRow = {
        id: result.data.id,
        name: form.name.trim(),
        isWeatherRelated: form.isWeatherRelated,
        status: editing?.status ?? "active",
      };

      setRows((prev) =>
        editing
          ? prev.map((r) => (r.id === saved.id ? saved : r))
          : [...prev, saved]
      );
      closeForm();
    });
  }

  function toggleStatus(r: StoppageReasonRow) {
    const next = r.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setStoppageReasonStatus(r.id, next);
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

  const columns: Column<StoppageReasonRow>[] = [
    {
      key: "name",
      header: "Reason",
      sortable: true,
      render: (r) => <span style={{ fontWeight: 500 }}>{r.name}</span>,
    },
    {
      key: "isWeatherRelated",
      header: "Weather",
      hideBelow: "md",
      render: (r) =>
        r.isWeatherRelated ? (
          <StatusBadge tone="neutral">Weather</StatusBadge>
        ) : (
          <span style={{ color: "var(--steel)" }}>—</span>
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
          <SecondaryButton
            onClick={() => toggleStatus(r)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            {r.status === "active" ? "Deactivate" : "Reactivate"}
          </SecondaryButton>
        </div>
      ),
    },
  ];

  const formOpen = creating || editing !== null;

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <PageTitle>Stoppage reasons</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            Why operations paused. Whether a stoppage counts against laytime is
            set per contract, not here.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add reason
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit ${editing.name}` : "Add a stoppage reason"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Reason name" required error={fieldErrors.name}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.name}
                  disabled={pending}
                  onChange={(e) => updateName(e.target.value)}
                />
              )}
            </Field>
          </div>

          <label
            className="flex items-center gap-2 text-[13px] mt-1 mb-2"
            style={{ color: "var(--ink-soft)" }}
          >
            <input
              type="checkbox"
              checked={form.isWeatherRelated}
              disabled={pending}
              onChange={(e) =>
                setForm((f) => ({ ...f, isWeatherRelated: e.target.checked }))
              }
            />
            Weather-related
          </label>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add reason"}
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
          placeholder="Search reasons"
          aria-label="Search stoppage reasons"
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
        caption="Stoppage reasons recorded for this organization"
        columns={columns}
        rows={visible}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No stoppage reasons yet"
              description="Add the reasons your operations pause for."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add reason
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No reason matches that search"
              description="Try a different name."
            />
          )
        }
      />
    </div>
  );
}