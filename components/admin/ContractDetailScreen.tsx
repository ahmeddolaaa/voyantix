"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  createLaytimePool,
  updateLaytimePool,
  type LaytimePoolRow,
  type LaytimePoolInput,
} from "@/lib/actions/laytime-pools";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import {
  Card,
  PageTitle,
  SectionHeading,
  SecondaryButton,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

type PoolFormState = {
  name: string;
  totalAllowance: string;
  allowanceUnit: string;
  settlementPolicy: string;
};

const emptyPoolForm: PoolFormState = {
  name: "",
  totalAllowance: "",
  allowanceUnit: "",
  settlementPolicy: "",
};

export function ContractDetailScreen({
  contractId,
  contractReference,
  counterparty,
  initialPools,
}: {
  contractId: string;
  contractReference: string;
  counterparty: string;
  initialPools: LaytimePoolRow[];
}) {
  const [pools, setPools] = useState(initialPools);
  const [editing, setEditing] = useState<LaytimePoolRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<PoolFormState>(emptyPoolForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof PoolFormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function updateField(key: keyof PoolFormState, value: string) {
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
    setForm(emptyPoolForm);
    setFieldErrors({});
    setFormError(null);
  }

  function openEdit(p: LaytimePoolRow) {
    setEditing(p);
    setCreating(false);
    setForm({
      name: p.name,
      totalAllowance: p.totalAllowance,
      allowanceUnit: p.allowanceUnit,
      settlementPolicy: p.settlementPolicy,
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

    const input: LaytimePoolInput = {
      name: form.name,
      totalAllowance: form.totalAllowance,
      allowanceUnit: form.allowanceUnit,
      settlementPolicy: form.settlementPolicy,
    };

    startTransition(async () => {
      const result = editing
        ? await updateLaytimePool(editing.id, input)
        : await createLaytimePool(contractId, input);

      if (!result.ok) {
        if (result.code === "DUPLICATE_NAME") {
          setFieldErrors({ name: result.message });
        } else {
          setFormError(result.message);
        }
        return;
      }

      const saved: LaytimePoolRow = {
        id: result.data.id,
        contractId,
        name: form.name.trim(),
        totalAllowance: form.totalAllowance.trim(),
        allowanceUnit: form.allowanceUnit.trim(),
        settlementPolicy: form.settlementPolicy.trim(),
      };

      setPools((prev) =>
        editing
          ? prev.map((p) => (p.id === saved.id ? saved : p))
          : [...prev, saved]
      );
      closeForm();
    });
  }

  const formOpen = creating || editing !== null;

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <Link
        href="/admin/contracts"
        className="text-[12.5px] hover:underline"
        style={{ color: "var(--steel)" }}
      >
        ← Contracts
      </Link>

      <div className="mt-2 mb-8">
        <PageTitle>{contractReference}</PageTitle>
        <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
          {counterparty}
        </p>
      </div>

      {/* ---- POOLS ---- */}
      <div className="flex items-center justify-between mb-3">
        <SectionHeading>Pools</SectionHeading>
        {!formOpen && (
          <SecondaryButton onClick={openCreate} disabled={pending}>
            Add pool
          </SecondaryButton>
        )}
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: "var(--steel)" }}>
        Reversible allowance pools. A term on this contract can share a pool so
        laytime is consumed across its port calls.
      </p>

      {formOpen && (
        <Card className="mb-4">
          <SectionHeading>
            {editing ? `Edit ${editing.name}` : "Add a pool"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Name" required error={fieldErrors.name}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.name}
                  disabled={pending}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="e.g. Load + Discharge pool"
                />
              )}
            </Field>
            <Field label="Total allowance" required error={fieldErrors.totalAllowance}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.totalAllowance}
                  disabled={pending}
                  onChange={(e) => updateField("totalAllowance", e.target.value)}
                  placeholder="e.g. 30"
                />
              )}
            </Field>
            <Field label="Allowance unit" required error={fieldErrors.allowanceUnit}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.allowanceUnit}
                  disabled={pending}
                  onChange={(e) => updateField("allowanceUnit", e.target.value)}
                  placeholder="e.g. days"
                />
              )}
            </Field>
            <Field label="Settlement policy" required error={fieldErrors.settlementPolicy}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.settlementPolicy}
                  disabled={pending}
                  onChange={(e) => updateField("settlementPolicy", e.target.value)}
                  placeholder="e.g. standard"
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add pool"}
            </SubmitButton>
            <SecondaryButton onClick={closeForm} disabled={pending}>
              Cancel
            </SecondaryButton>
          </div>
        </Card>
      )}

      {pools.length === 0 ? (
        <EmptyState
          title="No pools yet"
          description="Add a pool if this contract's laytime is reversible across port calls."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {pools.map((p) => (
            <Card key={p.id} className="!py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <span style={{ fontWeight: 500, color: "var(--ink)" }}>
                    {p.name}
                  </span>
                  <span className="text-[12.5px]" style={{ color: "var(--steel)" }}>
                    {p.totalAllowance} {p.allowanceUnit} · {p.settlementPolicy}
                  </span>
                </div>
                <SecondaryButton
                  onClick={() => openEdit(p)}
                  disabled={pending}
                  className="!px-2.5 !py-1 !text-[12px]"
                >
                  Edit
                </SecondaryButton>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}