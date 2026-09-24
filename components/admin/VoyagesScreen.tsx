"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  createVoyage,
  updateVoyage,
  setVoyageStatus,
  type VoyageRow,
} from "@/lib/actions/voyages";
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

type VoyageStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

type Option = { id: string; label: string; status: "active" | "inactive" };

type FormState = {
  voyageReference: string;
  vesselName: string;
  vesselId: string;
  contractId: string;
};

const emptyForm: FormState = {
  voyageReference: "",
  vesselName: "",
  vesselId: "",
  contractId: "",
};

const STATUS_LABEL: Record<VoyageStatus, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_TONE: Record<VoyageStatus, "teal" | "neutral"> = {
  ACTIVE: "teal",
  COMPLETED: "neutral",
  CANCELLED: "neutral",
};

export function VoyagesScreen({
  initialVoyages,
  vessels,
  contracts,
}: {
  initialVoyages: VoyageRow[];
  vessels: { id: string; name: string; status: "active" | "inactive" }[];
  contracts: { id: string; reference: string; status: "active" | "inactive" }[];
}) {
  const [rows, setRows] = useState(initialVoyages);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | VoyageStatus>("ALL");
  const [sort, setSort] = useState<SortState>({
    key: "voyageReference",
    direction: "asc",
  });

  const [editing, setEditing] = useState<VoyageRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const vesselOptions: Option[] = useMemo(
    () => vessels.map((v) => ({ id: v.id, label: v.name, status: v.status })),
    [vessels]
  );
  const contractOptions: Option[] = useMemo(
    () =>
      contracts.map((c) => ({ id: c.id, label: c.reference, status: c.status })),
    [contracts]
  );

  const vesselName = (id: string | null) =>
    id ? vesselOptions.find((o) => o.id === id)?.label ?? "—" : "—";
  const contractRef = (id: string | null) =>
    id ? contractOptions.find((o) => o.id === id)?.label ?? "—" : "—";

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (q === "") return true;
      return (
        r.voyageReference.toLowerCase().includes(q) ||
        r.vesselName.toLowerCase().includes(q)
      );
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof VoyageRow;
      const av = (a[key] ?? "") as string;
      const bv = (b[key] ?? "") as string;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, search, statusFilter, sort]);

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

  function openEdit(r: VoyageRow) {
    setEditing(r);
    setCreating(false);
    setForm({
      voyageReference: r.voyageReference,
      vesselName: r.vesselName,
      vesselId: r.vesselId ?? "",
      contractId: r.contractId ?? "",
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

  function submit() {
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      const input = {
        voyageReference: form.voyageReference || null,
        vesselName: form.vesselName,
        vesselId: form.vesselId || null,
        contractId: form.contractId || null,
      };

      if (editing) {
        const result = await updateVoyage(editing.id, input);
        if (!result.ok) {
          if (result.code === "DUPLICATE_CODE") {
            setFieldErrors({ voyageReference: result.message });
          } else {
            setFormError(result.message);
          }
          return;
        }
        const saved: VoyageRow = {
          id: editing.id,
          voyageReference: form.voyageReference.trim(),
          vesselName: form.vesselName.trim(),
          vesselId: form.vesselId || null,
          contractId: form.contractId || null,
          status: editing.status,
        };
        setRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        closeForm();
        return;
      }

      const result = await createVoyage(input);
      if (!result.ok) {
        if (result.code === "DUPLICATE_CODE") {
          setFieldErrors({ voyageReference: result.message });
        } else {
          setFormError(result.message);
        }
        return;
      }

      // The reference may have been GENERATED server-side, so take it from
      // the result rather than from the form.
      const saved: VoyageRow = {
        id: result.data.id,
        voyageReference: result.data.voyageReference,
        vesselName: form.vesselName.trim(),
        vesselId: form.vesselId || null,
        contractId: form.contractId || null,
        status: "ACTIVE",
      };
      setRows((prev) => [...prev, saved]);
      closeForm();
    });
  }

  function changeStatus(r: VoyageRow, next: VoyageStatus) {
    startTransition(async () => {
      const result = await setVoyageStatus(r.id, next);
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

  const columns: Column<VoyageRow>[] = [
    {
      key: "voyageReference",
      header: "Reference",
      sortable: true,
      render: (r) => (
        <Link
          href={`/admin/voyages/${r.id}`}
          className="hover:underline"
          style={{ fontWeight: 500, color: "var(--teal)" }}
        >
          {r.voyageReference}
        </Link>
      ),
    },
    {
      key: "vesselName",
      header: "Vessel",
      sortable: true,
      render: (r) => (
        <div>
          <div>{r.vesselName}</div>
          {r.vesselId && (
            <div className="text-[11.5px]" style={{ color: "var(--steel)" }}>
              linked: {vesselName(r.vesselId)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "contractId",
      header: "Contract",
      hideBelow: "md",
      render: (r) =>
        r.contractId ? (
          <span style={{ color: "var(--ink-soft)" }}>
            {contractRef(r.contractId)}
          </span>
        ) : (
          <span style={{ color: "var(--steel)" }}>—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={STATUS_TONE[r.status]}>
          {STATUS_LABEL[r.status]}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <div className="inline-flex gap-2 items-center">
          <SecondaryButton
            onClick={() => openEdit(r)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Edit
          </SecondaryButton>
          <select
            value={r.status}
            disabled={pending}
            onChange={(e) => changeStatus(r, e.target.value as VoyageStatus)}
            aria-label={`Status for ${r.voyageReference}`}
            className="px-2 py-1 rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
            style={{
              background: "var(--card)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          >
            <option value="ACTIVE">Active</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      ),
    },
  ];

  const formOpen = creating || editing !== null;

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <PageTitle>Voyages</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            The operational spine. Leave the reference blank to generate one
            from your company pattern.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add voyage
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit ${editing.voyageReference}` : "Add a voyage"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field
              label="Reference"
              required={editing !== null}
              error={fieldErrors.voyageReference}
              description={
                editing
                  ? undefined
                  : "Leave blank to generate from your company pattern"
              }
            >
              {(a) => (
                <TextInput
                  {...a}
                  value={form.voyageReference}
                  disabled={pending}
                  onChange={(e) => updateField("voyageReference", e.target.value)}
                  placeholder={editing ? "" : "Auto-generated if blank"}
                />
              )}
            </Field>

            <Field label="Vessel name" required error={fieldErrors.vesselName}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.vesselName}
                  disabled={pending}
                  onChange={(e) => updateField("vesselName", e.target.value)}
                  placeholder="e.g. MV Haj Yehia"
                />
              )}
            </Field>

            <Field
              label="Linked vessel"
              error={fieldErrors.vesselId}
              description="Optional — links this voyage to a master vessel record"
            >
              {(a) => (
                <select
                  {...a}
                  value={form.vesselId}
                  disabled={pending}
                  onChange={(e) => updateField("vesselId", e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                  }}
                >
                  <option value="">None</option>
                  {vesselOptions
                    .filter((o) => o.status === "active" || o.id === form.vesselId)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                        {o.status === "inactive" ? " (inactive)" : ""}
                      </option>
                    ))}
                </select>
              )}
            </Field>

            <Field
              label="Contract"
              error={fieldErrors.contractId}
              description="Optional — required later to resolve commercial terms"
            >
              {(a) => (
                <select
                  {...a}
                  value={form.contractId}
                  disabled={pending}
                  onChange={(e) => updateField("contractId", e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                  }}
                >
                  <option value="">None</option>
                  {contractOptions
                    .filter((o) => o.status === "active" || o.id === form.contractId)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                        {o.status === "inactive" ? " (inactive)" : ""}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add voyage"}
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
          placeholder="Search voyages"
          aria-label="Search voyages"
          className="px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            minWidth: "260px",
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "ALL" | VoyageStatus)
          }
          aria-label="Filter by status"
          className="px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
          }}
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <span className="text-[12px] ml-auto" style={{ color: "var(--steel)" }}>
          {visible.length} of {rows.length}
        </span>
      </div>

      <DataTable
        caption="Voyages for this organization"
        columns={columns}
        rows={visible}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No voyages yet"
              description="Add a voyage to start tracking port calls against it."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add voyage
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No voyage matches that search"
              description="Try a different reference or vessel name."
            />
          )
        }
      />
    </div>
  );
}