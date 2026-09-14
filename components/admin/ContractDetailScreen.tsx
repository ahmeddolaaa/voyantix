"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  createLaytimePool,
  updateLaytimePool,
  type LaytimePoolRow,
  type LaytimePoolInput,
} from "@/lib/actions/laytime-pools";
import {
  createContractLaytimeTerm,
  updateContractLaytimeTerm,
  setContractLaytimeTermStatus,
  type ContractLaytimeTermRow,
  type ContractLaytimeTermInput,
} from "@/lib/actions/contract-laytime-terms";
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

type MasterOption = { id: string; name: string; status: "active" | "inactive" };
type VersionOption = {
  id: string;
  ruleSetName: string;
  versionNumber: number;
  label: string;
};

// ── Pool form ──────────────────────────────────────────────────────────────
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

// ── Term form ──────────────────────────────────────────────────────────────
type TermFormState = {
  function: "LOAD" | "DISCHARGE";
  portId: string;
  cargoId: string;
  ruleSetVersionId: string;
  allowance: string;
  allowanceUnit: string;
  demurrageRate: string;
  despatchRate: string;
  despatchBasis: string;
  turnTimeHours: string;
  turnTimeTrigger: string;
  commencementRule: string;
  poolId: string;
};
const emptyTermForm: TermFormState = {
  function: "LOAD",
  portId: "",
  cargoId: "",
  ruleSetVersionId: "",
  allowance: "",
  allowanceUnit: "",
  demurrageRate: "",
  despatchRate: "",
  despatchBasis: "",
  turnTimeHours: "",
  turnTimeTrigger: "",
  commencementRule: "",
  poolId: "",
};

const selectStyle = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
} as const;

/** Options for a master-data select: active rows, plus the currently-selected
 *  row even if it is inactive (so an existing term's value stays visible). */
function optionsWithCurrent(
  all: MasterOption[],
  currentId: string
): MasterOption[] {
  const active = all.filter((o) => o.status === "active");
  if (currentId && !active.some((o) => o.id === currentId)) {
    const current = all.find((o) => o.id === currentId);
    if (current) return [current, ...active];
  }
  return active;
}

export function ContractDetailScreen({
  contractId,
  contractReference,
  counterparty,
  initialPools,
  initialTerms,
  versionOptions,
  ports,
  cargoes,
}: {
  contractId: string;
  contractReference: string;
  counterparty: string;
  initialPools: LaytimePoolRow[];
  initialTerms: ContractLaytimeTermRow[];
  versionOptions: VersionOption[];
  ports: MasterOption[];
  cargoes: MasterOption[];
}) {
  const [pending, startTransition] = useTransition();

  // ── Pools state ──────────────────────────────────────────────────────────
  const [pools, setPools] = useState(initialPools);
  const [poolEditing, setPoolEditing] = useState<LaytimePoolRow | null>(null);
  const [poolCreating, setPoolCreating] = useState(false);
  const [poolForm, setPoolForm] = useState<PoolFormState>(emptyPoolForm);
  const [poolFieldErrors, setPoolFieldErrors] = useState<Partial<Record<keyof PoolFormState, string>>>({});
  const [poolFormError, setPoolFormError] = useState<string | null>(null);

  // ── Terms state ──────────────────────────────────────────────────────────
  const [terms, setTerms] = useState(initialTerms);
  const [termEditing, setTermEditing] = useState<ContractLaytimeTermRow | null>(null);
  const [termCreating, setTermCreating] = useState(false);
  const [termForm, setTermForm] = useState<TermFormState>(emptyTermForm);
  const [termFieldErrors, setTermFieldErrors] = useState<Partial<Record<keyof TermFormState, string>>>({});
  const [termFormError, setTermFormError] = useState<string | null>(null);

  const portName = useMemo(
    () => Object.fromEntries(ports.map((p) => [p.id, p.name])),
    [ports]
  );
  const cargoName = useMemo(
    () => Object.fromEntries(cargoes.map((c) => [c.id, c.name])),
    [cargoes]
  );
  const versionLabel = useMemo(
    () => Object.fromEntries(versionOptions.map((v) => [v.id, v.label])),
    [versionOptions]
  );
  const poolName = useMemo(
    () => Object.fromEntries(pools.map((p) => [p.id, p.name])),
    [pools]
  );

  // ── Pool handlers ────────────────────────────────────────────────────────
  function updatePoolField(key: keyof PoolFormState, value: string) {
    setPoolForm((f) => ({ ...f, [key]: value }));
    setPoolFieldErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }
  function openPoolCreate() {
    setPoolCreating(true);
    setPoolEditing(null);
    setPoolForm(emptyPoolForm);
    setPoolFieldErrors({});
    setPoolFormError(null);
  }
  function openPoolEdit(p: LaytimePoolRow) {
    setPoolEditing(p);
    setPoolCreating(false);
    setPoolForm({
      name: p.name,
      totalAllowance: p.totalAllowance,
      allowanceUnit: p.allowanceUnit,
      settlementPolicy: p.settlementPolicy,
    });
    setPoolFieldErrors({});
    setPoolFormError(null);
  }
  function closePoolForm() {
    setPoolCreating(false);
    setPoolEditing(null);
    setPoolFieldErrors({});
    setPoolFormError(null);
  }
  function submitPool() {
    setPoolFieldErrors({});
    setPoolFormError(null);
    const input: LaytimePoolInput = {
      name: poolForm.name,
      totalAllowance: poolForm.totalAllowance,
      allowanceUnit: poolForm.allowanceUnit,
      settlementPolicy: poolForm.settlementPolicy,
    };
    startTransition(async () => {
      const result = poolEditing
        ? await updateLaytimePool(poolEditing.id, input)
        : await createLaytimePool(contractId, input);
      if (!result.ok) {
        if (result.code === "DUPLICATE_NAME") setPoolFieldErrors({ name: result.message });
        else setPoolFormError(result.message);
        return;
      }
      const saved: LaytimePoolRow = {
        id: result.data.id,
        contractId,
        name: poolForm.name.trim(),
        totalAllowance: poolForm.totalAllowance.trim(),
        allowanceUnit: poolForm.allowanceUnit.trim(),
        settlementPolicy: poolForm.settlementPolicy.trim(),
      };
      setPools((prev) =>
        poolEditing ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]
      );
      closePoolForm();
    });
  }

  // ── Term handlers ────────────────────────────────────────────────────────
  function updateTermField(key: keyof TermFormState, value: string) {
    setTermForm((f) => ({ ...f, [key]: value }));
    setTermFieldErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }
  function openTermCreate() {
    setTermCreating(true);
    setTermEditing(null);
    setTermForm(emptyTermForm);
    setTermFieldErrors({});
    setTermFormError(null);
  }
  function openTermEdit(t: ContractLaytimeTermRow) {
    setTermEditing(t);
    setTermCreating(false);
    setTermForm({
      function: t.function,
      portId: t.portId ?? "",
      cargoId: t.cargoId ?? "",
      ruleSetVersionId: t.ruleSetVersionId,
      allowance: t.allowance,
      allowanceUnit: t.allowanceUnit,
      demurrageRate: t.demurrageRate,
      despatchRate: t.despatchRate ?? "",
      despatchBasis: t.despatchBasis ?? "",
      turnTimeHours: t.turnTimeHours ?? "",
      turnTimeTrigger: t.turnTimeTrigger ?? "",
      commencementRule: t.commencementRule,
      poolId: t.poolId ?? "",
    });
    setTermFieldErrors({});
    setTermFormError(null);
  }
  function closeTermForm() {
    setTermCreating(false);
    setTermEditing(null);
    setTermFieldErrors({});
    setTermFormError(null);
  }
  function submitTerm() {
    setTermFieldErrors({});
    setTermFormError(null);
    const input: ContractLaytimeTermInput = {
      function: termForm.function,
      portId: termForm.portId || null,
      cargoId: termForm.cargoId || null,
      ruleSetVersionId: termForm.ruleSetVersionId,
      allowance: termForm.allowance,
      allowanceUnit: termForm.allowanceUnit,
      demurrageRate: termForm.demurrageRate,
      despatchRate: termForm.despatchRate || null,
      despatchBasis: termForm.despatchBasis || null,
      turnTimeHours: termForm.turnTimeHours || null,
      turnTimeTrigger: termForm.turnTimeTrigger || null,
      commencementRule: termForm.commencementRule,
      poolId: termForm.poolId || null,
    };
    startTransition(async () => {
      const result = termEditing
        ? await updateContractLaytimeTerm(termEditing.id, input)
        : await createContractLaytimeTerm(contractId, input);
      if (!result.ok) {
        if (result.code === "VALIDATION_ERROR") setTermFormError(result.message);
        else setTermFormError(result.message);
        return;
      }
      const saved: ContractLaytimeTermRow = {
        id: result.data.id,
        contractId,
        function: termForm.function,
        portId: termForm.portId || null,
        cargoId: termForm.cargoId || null,
        allowance: termForm.allowance.trim(),
        allowanceUnit: termForm.allowanceUnit.trim(),
        demurrageRate: termForm.demurrageRate.trim(),
        despatchRate: termForm.despatchRate.trim() || null,
        despatchBasis: termForm.despatchBasis.trim() || null,
        turnTimeHours: termForm.turnTimeHours.trim() || null,
        turnTimeTrigger: termForm.turnTimeTrigger.trim() || null,
        commencementRule: termForm.commencementRule.trim(),
        ruleSetVersionId: termForm.ruleSetVersionId,
        poolId: termForm.poolId || null,
        status: termEditing?.status ?? "active",
      };
      setTerms((prev) =>
        termEditing ? prev.map((t) => (t.id === saved.id ? saved : t)) : [...prev, saved]
      );
      closeTermForm();
    });
  }
  function toggleTermStatus(t: ContractLaytimeTermRow) {
    const next = t.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setContractLaytimeTermStatus(t.id, next);
      if (!result.ok) {
        setTermFormError(result.message);
        return;
      }
      if (result.data.changed) {
        setTerms((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
      }
    });
  }

  const portOptions = optionsWithCurrent(ports, termForm.portId);
  const cargoOptions = optionsWithCurrent(cargoes, termForm.cargoId);

  const termColumns: Column<ContractLaytimeTermRow>[] = [
    {
      key: "function",
      header: "Function",
      render: (t) => (
        <StatusBadge tone={t.function === "LOAD" ? "neutral" : "neutral"}>
          {t.function}
        </StatusBadge>
      ),
    },
    {
      key: "scope",
      header: "Scope",
      render: (t) => (
        <span className="text-[12.5px]" style={{ color: "var(--ink-soft)" }}>
          {t.portId ? portName[t.portId] ?? "Port" : "Any port"} ·{" "}
          {t.cargoId ? cargoName[t.cargoId] ?? "Cargo" : "Any cargo"}
        </span>
      ),
    },
    {
      key: "allowance",
      header: "Allowance",
      render: (t) => (
        <span className="font-mono text-[12.5px]">
          {t.allowance} {t.allowanceUnit}
        </span>
      ),
    },
    {
      key: "ruleSetVersionId",
      header: "Rule set",
      hideBelow: "md",
      render: (t) => (
        <span className="text-[12.5px]">{versionLabel[t.ruleSetVersionId] ?? "—"}</span>
      ),
    },
    {
      key: "poolId",
      header: "Pool",
      hideBelow: "md",
      render: (t) =>
        t.poolId ? (
          <span className="text-[12.5px]">{poolName[t.poolId] ?? "Pool"}</span>
        ) : (
          <span style={{ color: "var(--steel)" }}>—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (t) => (
        <StatusBadge tone={t.status === "active" ? "teal" : "neutral"}>
          {t.status === "active" ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (t) => (
        <div className="inline-flex gap-2">
          <SecondaryButton
            onClick={() => openTermEdit(t)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Edit
          </SecondaryButton>
          <SecondaryButton
            onClick={() => toggleTermStatus(t)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            {t.status === "active" ? "Deactivate" : "Reactivate"}
          </SecondaryButton>
        </div>
      ),
    },
  ];

  const poolFormOpen = poolCreating || poolEditing !== null;
  const termFormOpen = termCreating || termEditing !== null;

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
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

      {/* ══ POOLS ══ */}
      <div className="flex items-center justify-between mb-3">
        <SectionHeading>Pools</SectionHeading>
        {!poolFormOpen && (
          <SecondaryButton onClick={openPoolCreate} disabled={pending}>
            Add pool
          </SecondaryButton>
        )}
      </div>

      {poolFormOpen && (
        <Card className="mb-4">
          <SectionHeading>
            {poolEditing ? `Edit ${poolEditing.name}` : "Add a pool"}
          </SectionHeading>
          <FormError message={poolFormError} />
          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Name" required error={poolFieldErrors.name}>
              {(a) => (
                <TextInput {...a} value={poolForm.name} disabled={pending}
                  onChange={(e) => updatePoolField("name", e.target.value)} />
              )}
            </Field>
            <Field label="Total allowance" required error={poolFieldErrors.totalAllowance}>
              {(a) => (
                <TextInput {...a} value={poolForm.totalAllowance} disabled={pending}
                  onChange={(e) => updatePoolField("totalAllowance", e.target.value)} placeholder="e.g. 30" />
              )}
            </Field>
            <Field label="Allowance unit" required error={poolFieldErrors.allowanceUnit}>
              {(a) => (
                <TextInput {...a} value={poolForm.allowanceUnit} disabled={pending}
                  onChange={(e) => updatePoolField("allowanceUnit", e.target.value)} placeholder="e.g. days" />
              )}
            </Field>
            <Field label="Settlement policy" required error={poolFieldErrors.settlementPolicy}>
              {(a) => (
                <TextInput {...a} value={poolForm.settlementPolicy} disabled={pending}
                  onChange={(e) => updatePoolField("settlementPolicy", e.target.value)} />
              )}
            </Field>
          </div>
          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submitPool} pending={pending}>
              {poolEditing ? "Save changes" : "Add pool"}
            </SubmitButton>
            <SecondaryButton onClick={closePoolForm} disabled={pending}>Cancel</SecondaryButton>
          </div>
        </Card>
      )}

      {pools.length === 0 ? (
        <p className="text-[12.5px] mb-8" style={{ color: "var(--steel)" }}>
          No pools yet. Add one if this contract&apos;s laytime is reversible across port calls.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mb-8">
          {pools.map((p) => (
            <Card key={p.id} className="!py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <span style={{ fontWeight: 500, color: "var(--ink)" }}>{p.name}</span>
                  <span className="text-[12.5px]" style={{ color: "var(--steel)" }}>
                    {p.totalAllowance} {p.allowanceUnit} · {p.settlementPolicy}
                  </span>
                </div>
                <SecondaryButton onClick={() => openPoolEdit(p)} disabled={pending}
                  className="!px-2.5 !py-1 !text-[12px]">Edit</SecondaryButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ══ TERMS ══ */}
      <div className="flex items-center justify-between mb-3">
        <SectionHeading>Laytime terms</SectionHeading>
        {!termFormOpen && (
          <SubmitButton onClick={openTermCreate} pending={false}>
            Add term
          </SubmitButton>
        )}
      </div>

      {termFormOpen && (
        <Card className="mb-4">
          <SectionHeading>
            {termEditing ? "Edit term" : "Add a term"}
          </SectionHeading>
          <FormError message={termFormError} />

          <p className="text-[12px] font-semibold mt-1 mb-2" style={{ color: "var(--steel)" }}>SCOPE</p>
          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Function" required>
              {(a) => (
                <select {...a} value={termForm.function} disabled={pending}
                  onChange={(e) => updateTermField("function", e.target.value)}
                  className="px-3 py-2 rounded-md text-[13px] w-full" style={selectStyle}>
                  <option value="LOAD">LOAD</option>
                  <option value="DISCHARGE">DISCHARGE</option>
                </select>
              )}
            </Field>
            <Field label="Rule set version" required error={termFieldErrors.ruleSetVersionId}>
              {(a) => (
                <select {...a} value={termForm.ruleSetVersionId} disabled={pending}
                  onChange={(e) => updateTermField("ruleSetVersionId", e.target.value)}
                  className="px-3 py-2 rounded-md text-[13px] w-full" style={selectStyle}>
                  <option value="">Select a version…</option>
                  {versionOptions.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Port">
              {(a) => (
                <select {...a} value={termForm.portId} disabled={pending}
                  onChange={(e) => updateTermField("portId", e.target.value)}
                  className="px-3 py-2 rounded-md text-[13px] w-full" style={selectStyle}>
                  <option value="">Any port</option>
                  {portOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.status === "inactive" ? " (inactive)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Cargo">
              {(a) => (
                <select {...a} value={termForm.cargoId} disabled={pending}
                  onChange={(e) => updateTermField("cargoId", e.target.value)}
                  className="px-3 py-2 rounded-md text-[13px] w-full" style={selectStyle}>
                  <option value="">Any cargo</option>
                  {cargoOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.status === "inactive" ? " (inactive)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <p className="text-[12px] font-semibold mt-4 mb-2" style={{ color: "var(--steel)" }}>ALLOWANCE &amp; RATES</p>
          <div className="grid md:grid-cols-3 gap-x-6">
            <Field label="Allowance" required>
              {(a) => (<TextInput {...a} value={termForm.allowance} disabled={pending}
                onChange={(e) => updateTermField("allowance", e.target.value)} placeholder="e.g. 5" />)}
            </Field>
            <Field label="Allowance unit" required>
              {(a) => (<TextInput {...a} value={termForm.allowanceUnit} disabled={pending}
                onChange={(e) => updateTermField("allowanceUnit", e.target.value)} placeholder="unit of allowance" />)}
            </Field>
            <Field label="Demurrage rate" required>
              {(a) => (<TextInput {...a} value={termForm.demurrageRate} disabled={pending}
                onChange={(e) => updateTermField("demurrageRate", e.target.value)} placeholder="per day" />)}
            </Field>
            <Field label="Despatch rate">
              {(a) => (<TextInput {...a} value={termForm.despatchRate} disabled={pending}
                onChange={(e) => updateTermField("despatchRate", e.target.value)} placeholder="optional" />)}
            </Field>
            <Field label="Despatch basis">
              {(a) => (<TextInput {...a} value={termForm.despatchBasis} disabled={pending}
                onChange={(e) => updateTermField("despatchBasis", e.target.value)} placeholder="optional" />)}
            </Field>
          </div>

          <p className="text-[12px] font-semibold mt-4 mb-2" style={{ color: "var(--steel)" }}>TURN TIME &amp; COMMENCEMENT</p>
          <div className="grid md:grid-cols-3 gap-x-6">
            <Field label="Turn time hours">
              {(a) => (<TextInput {...a} value={termForm.turnTimeHours} disabled={pending}
                onChange={(e) => updateTermField("turnTimeHours", e.target.value)} placeholder="optional" />)}
            </Field>
            <Field label="Turn time trigger">
              {(a) => (<TextInput {...a} value={termForm.turnTimeTrigger} disabled={pending}
                onChange={(e) => updateTermField("turnTimeTrigger", e.target.value)} placeholder="optional" />)}
            </Field>
            <Field label="Commencement rule" required>
              {(a) => (<TextInput {...a} value={termForm.commencementRule} disabled={pending}
                onChange={(e) => updateTermField("commencementRule", e.target.value)} placeholder="how laytime commences" />)}
            </Field>
          </div>

          <p className="text-[12px] font-semibold mt-4 mb-2" style={{ color: "var(--steel)" }}>POOL</p>
          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Pool">
              {(a) => (
                <select {...a} value={termForm.poolId} disabled={pending}
                  onChange={(e) => updateTermField("poolId", e.target.value)}
                  className="px-3 py-2 rounded-md text-[13px] w-full" style={selectStyle}>
                  <option value="">None</option>
                  {pools.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-4">
            <SubmitButton onClick={submitTerm} pending={pending}>
              {termEditing ? "Save changes" : "Add term"}
            </SubmitButton>
            <SecondaryButton onClick={closeTermForm} disabled={pending}>Cancel</SecondaryButton>
          </div>
        </Card>
      )}

      <DataTable
        caption="Laytime terms for this contract"
        columns={termColumns}
        rows={terms}
        getRowId={(t) => t.id}
        empty={
          <EmptyState
            title="No terms yet"
            description="Add a laytime term to define allowance, rates and the rule set that apply."
            action={
              <SubmitButton onClick={openTermCreate} pending={false}>Add term</SubmitButton>
            }
          />
        }
      />
    </div>
  );
}