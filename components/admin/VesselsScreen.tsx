"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createVessel,
  updateVessel,
  setVesselStatus,
  type VesselRow,
} from "@/lib/actions/vessels";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import {
  Field,
  TextInput,
  FormError,
  SubmitButton,
} from "@/components/forms";
import {
  Card,
  PageTitle,
  SectionHeading,
  SecondaryButton,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

/**
 * VESSELS ADMINISTRATION
 *
 * These records are a convenience, not a gate: a voyage can name a vessel
 * that was never entered here. The screen says so plainly, so nobody
 * assumes the fleet must be catalogued before operations can start.
 */

type FormState = {
  name: string;
  imo: string;
  dwt: string;
  flag: string;
};

const emptyForm: FormState = { name: "", imo: "", dwt: "", flag: "" };

const numberFormat = new Intl.NumberFormat("en-US");

export function VesselsScreen({
  initialVessels,
}: {
  initialVessels: VesselRow[];
}) {
  const [rows, setRows] = useState(initialVessels);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });

  const [editing, setEditing] = useState<VesselRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((v) => {
      if (!showInactive && v.status === "inactive") return false;
      if (q === "") return true;
      return (
        v.name.toLowerCase().includes(q) ||
        (v.imo ?? "").includes(q) ||
        (v.flag ?? "").toLowerCase().includes(q)
      );
    });

    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "dwt") {
        return ((a.dwt ?? 0) - (b.dwt ?? 0)) * dir;
      }
      const key = sort.key as keyof VesselRow;
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

  function openEdit(v: VesselRow) {
    setEditing(v);
    setCreating(false);
    setForm({
      name: v.name,
      imo: v.imo ?? "",
      dwt: v.dwt === null ? "" : String(v.dwt),
      flag: v.flag ?? "",
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

  function applyFailure(code: string, message: string) {
    if (code === "DUPLICATE_CODE") {
      setFieldErrors({ imo: message });
    } else if (code === "VALIDATION_ERROR" && /IMO/i.test(message)) {
      setFieldErrors({ imo: message });
    } else if (code === "VALIDATION_ERROR" && /[Dd]eadweight/.test(message)) {
      setFieldErrors({ dwt: message });
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
        imo: form.imo || null,
        dwt: form.dwt || null,
        flag: form.flag || null,
      };

      const result = editing
        ? await updateVessel(editing.id, input)
        : await createVessel(input);

      if (!result.ok) {
        applyFailure(result.code, result.message);
        return;
      }

      const saved: VesselRow = {
        id: result.data.id,
        name: form.name.trim(),
        imo: form.imo.trim() || null,
        dwt: form.dwt.trim() === "" ? null : Number(form.dwt.trim()),
        flag: form.flag.trim() || null,
        status: editing?.status ?? "active",
      };

      setRows((prev) =>
        editing
          ? prev.map((v) => (v.id === saved.id ? saved : v))
          : [...prev, saved]
      );
      closeForm();
    });
  }

  function toggleStatus(v: VesselRow) {
    const next = v.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setVesselStatus(v.id, next);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      if (result.data.changed) {
        setRows((prev) =>
          prev.map((x) => (x.id === v.id ? { ...x, status: next } : x))
        );
      }
    });
  }

  const columns: Column<VesselRow>[] = [
    {
      key: "name",
      header: "Vessel",
      sortable: true,
      render: (v) => <span style={{ fontWeight: 500 }}>{v.name}</span>,
    },
    {
      key: "imo",
      header: "IMO",
      sortable: true,
      render: (v) =>
        v.imo ? (
          <span className="num">{v.imo}</span>
        ) : (
          <span style={{ color: "var(--steel)" }}>—</span>
        ),
    },
    {
      key: "dwt",
      header: "DWT",
      sortable: true,
      align: "end",
      hideBelow: "md",
      render: (v) =>
        v.dwt === null ? (
          <span style={{ color: "var(--steel)" }}>—</span>
        ) : (
          <span className="num">{numberFormat.format(v.dwt)}</span>
        ),
    },
    {
      key: "flag",
      header: "Flag",
      sortable: true,
      hideBelow: "lg",
      render: (v) => v.flag ?? <span style={{ color: "var(--steel)" }}>—</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (v) => (
        <StatusBadge tone={v.status === "active" ? "teal" : "neutral"}>
          {v.status === "active" ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (v) => (
        <div className="inline-flex gap-2">
          <SecondaryButton
            onClick={() => openEdit(v)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Edit
          </SecondaryButton>
          <SecondaryButton
            onClick={() => toggleStatus(v)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            {v.status === "active" ? "Deactivate" : "Reactivate"}
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
          <PageTitle>Vessels</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            Vessels you work with regularly. Optional — a voyage can name any
            vessel, whether or not it is listed here.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add vessel
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit ${editing.name}` : "Add a vessel"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Vessel name" required error={fieldErrors.name}>
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
              label="IMO number"
              description="Optional, but it is what reliably identifies a hull."
              error={fieldErrors.imo}
            >
              {(a) => (
                <TextInput
                  {...a}
                  value={form.imo}
                  disabled={pending}
                  inputMode="numeric"
                  placeholder="7 digits"
                  onChange={(e) => updateField("imo", e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Deadweight"
              description="Optional. Tonnes."
              error={fieldErrors.dwt}
            >
              {(a) => (
                <TextInput
                  {...a}
                  value={form.dwt}
                  disabled={pending}
                  inputMode="numeric"
                  onChange={(e) => updateField("dwt", e.target.value)}
                />
              )}
            </Field>

            <Field label="Flag" description="Optional." error={fieldErrors.flag}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.flag}
                  disabled={pending}
                  onChange={(e) => updateField("flag", e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add vessel"}
            </SubmitButton>
            <SecondaryButton onClick={closeForm} disabled={pending}>
              Cancel
            </SecondaryButton>
          </div>

          {editing && (
            <p className="text-[11.5px] mt-3" style={{ color: "var(--steel)" }}>
              Renaming a vessel here does not change voyages already recorded
              under its previous name.
            </p>
          )}
        </Card>
      )}

      <div className="flex items-center gap-3 mb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vessels"
          aria-label="Search vessels"
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
        caption="Vessels recorded for this organization"
        columns={columns}
        rows={visible}
        getRowId={(v) => v.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No vessels yet"
              description="Add the vessels you charter often. You can always name a vessel directly on a voyage instead."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add vessel
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No vessels match that search"
              description="Try a different name, IMO number or flag."
            />
          )
        }
      />
    </div>
  );
}
