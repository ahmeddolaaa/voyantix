"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  createContract,
  updateContract,
  setContractStatus,
  type ContractRow,
} from "@/lib/actions/contracts";
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

type FormState = { reference: string; counterparty: string; contractDate: string };
const emptyForm: FormState = { reference: "", counterparty: "", contractDate: "" };

export function ContractsScreen({
  initialContracts,
}: {
  initialContracts: ContractRow[];
}) {
  const [rows, setRows] = useState(initialContracts);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "reference", direction: "asc" });

  const [editing, setEditing] = useState<ContractRow | null>(null);
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
      return (
        r.reference.toLowerCase().includes(q) ||
        r.counterparty.toLowerCase().includes(q)
      );
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof ContractRow;
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

  function openEdit(r: ContractRow) {
    setEditing(r);
    setCreating(false);
    setForm({
      reference: r.reference,
      counterparty: r.counterparty,
      contractDate: r.contractDate ?? "",
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
        reference: form.reference,
        counterparty: form.counterparty,
        contractDate: form.contractDate || null,
      };
      const result = editing
        ? await updateContract(editing.id, input)
        : await createContract(input);

      if (!result.ok) {
        if (result.code === "DUPLICATE_CODE") {
          setFieldErrors({ reference: result.message });
        } else {
          setFormError(result.message);
        }
        return;
      }

      const saved: ContractRow = {
        id: result.data.id,
        reference: form.reference.trim(),
        counterparty: form.counterparty.trim(),
        contractDate: form.contractDate.trim() || null,
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

  function toggleStatus(r: ContractRow) {
    const next = r.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setContractStatus(r.id, next);
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

  const columns: Column<ContractRow>[] = [
    {
      key: "reference",
      header: "Reference",
      sortable: true,
      render: (r) => (
        <Link
          href={`/admin/contracts/${r.id}`}
          className="hover:underline"
          style={{ fontWeight: 500, color: "var(--brass)" }}
        >
          {r.reference}
        </Link>
      ),
    },
    {
      key: "counterparty",
      header: "Counterparty",
      sortable: true,
      render: (r) => <span>{r.counterparty}</span>,
    },
    {
      key: "contractDate",
      header: "Date",
      hideBelow: "md",
      render: (r) =>
        r.contractDate ? (
          <span style={{ color: "var(--ink-soft)" }}>{r.contractDate}</span>
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
          <PageTitle>Contracts</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            Fixture headers. Each contract holds its laytime terms and pools —
            open a contract to manage them.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add contract
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit ${editing.reference}` : "Add a contract"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-3 gap-x-6">
            <Field label="Reference" required error={fieldErrors.reference}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.reference}
                  disabled={pending}
                  onChange={(e) => updateField("reference", e.target.value)}
                  placeholder="e.g. CP-2026-014"
                />
              )}
            </Field>

            <Field label="Counterparty" required error={fieldErrors.counterparty}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.counterparty}
                  disabled={pending}
                  onChange={(e) => updateField("counterparty", e.target.value)}
                  placeholder="e.g. Cargill"
                />
              )}
            </Field>

            <Field label="Date" error={fieldErrors.contractDate}>
              {(a) => (
                <TextInput
                  {...a}
                  type="date"
                  value={form.contractDate}
                  disabled={pending}
                  onChange={(e) => updateField("contractDate", e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add contract"}
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
          placeholder="Search contracts"
          aria-label="Search contracts"
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
        caption="Contracts for this organization"
        columns={columns}
        rows={visible}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No contracts yet"
              description="Add a contract, then open it to configure its laytime terms and pools."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add contract
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No contract matches that search"
              description="Try a different reference or counterparty."
            />
          )
        }
      />
    </div>
  );
}