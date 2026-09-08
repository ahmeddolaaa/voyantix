"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createCargo,
  updateCargo,
  setCargoStatus,
  type CargoRow,
} from "@/lib/actions/cargoes";
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

type FormState = { name: string; grade: string };
const emptyForm: FormState = { name: "", grade: "" };

export function CargoesScreen({
  initialCargoes,
}: {
  initialCargoes: CargoRow[];
}) {
  const [rows, setRows] = useState(initialCargoes);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });

  const [editing, setEditing] = useState<CargoRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((c) => {
      if (!showInactive && c.status === "inactive") return false;
      if (q === "") return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.grade ?? "").toLowerCase().includes(q)
      );
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof CargoRow;
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

  function openEdit(c: CargoRow) {
    setEditing(c);
    setCreating(false);
    setForm({ name: c.name, grade: c.grade ?? "" });
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
      const input = { name: form.name, grade: form.grade || null };
      const result = editing
        ? await updateCargo(editing.id, input)
        : await createCargo(input);

      if (!result.ok) {
        if (result.code === "DUPLICATE_NAME") {
          setFieldErrors({ name: result.message });
        } else {
          setFormError(result.message);
        }
        return;
      }

      const saved: CargoRow = {
        id: result.data.id,
        name: form.name.trim(),
        grade: form.grade.trim() || null,
        status: editing?.status ?? "active",
      };

      setRows((prev) =>
        editing
          ? prev.map((c) => (c.id === saved.id ? saved : c))
          : [...prev, saved]
      );
      closeForm();
    });
  }

  function toggleStatus(c: CargoRow) {
    const next = c.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setCargoStatus(c.id, next);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      if (result.data.changed) {
        setRows((prev) =>
          prev.map((x) => (x.id === c.id ? { ...x, status: next } : x))
        );
      }
    });
  }

  const columns: Column<CargoRow>[] = [
    {
      key: "name",
      header: "Cargo",
      sortable: true,
      render: (c) => <span style={{ fontWeight: 500 }}>{c.name}</span>,
    },
    {
      key: "grade",
      header: "Grade",
      sortable: true,
      hideBelow: "md",
      render: (c) => c.grade ?? <span style={{ color: "var(--steel)" }}>—</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <StatusBadge tone={c.status === "active" ? "teal" : "neutral"}>
          {c.status === "active" ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (c) => (
        <div className="inline-flex gap-2">
          <SecondaryButton
            onClick={() => openEdit(c)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Edit
          </SecondaryButton>
          <SecondaryButton
            onClick={() => toggleStatus(c)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            {c.status === "active" ? "Deactivate" : "Reactivate"}
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
          <PageTitle>Cargo</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            The commodities you load and discharge.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add cargo
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit ${editing.name}` : "Add a cargo"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Cargo name" required error={fieldErrors.name}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.name}
                  disabled={pending}
                  onChange={(e) => updateField("name", e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Grade"
              description="Optional. Use it when the grade changes the commercial terms."
              error={fieldErrors.grade}
            >
              {(a) => (
                <TextInput
                  {...a}
                  value={form.grade}
                  disabled={pending}
                  onChange={(e) => updateField("grade", e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add cargo"}
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
          placeholder="Search cargo"
          aria-label="Search cargo"
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
        caption="Cargo recorded for this organization"
        columns={columns}
        rows={visible}
        getRowId={(c) => c.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No cargo yet"
              description="Add the commodities your vessels carry."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add cargo
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No cargo matches that search"
              description="Try a different name or grade."
            />
          )
        }
      />
    </div>
  );
}
