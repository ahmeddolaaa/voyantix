"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  createLaytimeRuleSet,
  updateLaytimeRuleSet,
  type LaytimeRuleSetRow,
} from "@/lib/actions/laytime-rule-sets";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import {
  Card,
  PageTitle,
  SectionHeading,
  SecondaryButton,
  EmptyState,
} from "@/components/ui";

type FormState = { name: string; description: string };
const emptyForm: FormState = { name: "", description: "" };

export function RuleSetsScreen({
  initialRuleSets,
}: {
  initialRuleSets: LaytimeRuleSetRow[];
}) {
  const [rows, setRows] = useState(initialRuleSets);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });

  const [editing, setEditing] = useState<LaytimeRuleSetRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (q === "") return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
      );
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof LaytimeRuleSetRow;
      const av = (a[key] ?? "") as string;
      const bv = (b[key] ?? "") as string;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, search, sort]);

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

  function openEdit(r: LaytimeRuleSetRow) {
    setEditing(r);
    setCreating(false);
    setForm({ name: r.name, description: r.description ?? "" });
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
      const input = { name: form.name, description: form.description };
      const result = editing
        ? await updateLaytimeRuleSet(editing.id, input)
        : await createLaytimeRuleSet(input);

      if (!result.ok) {
        if (result.code === "DUPLICATE_NAME") {
          setFieldErrors({ name: result.message });
        } else {
          setFormError(result.message);
        }
        return;
      }

      const savedName = form.name.trim();
      const savedDescription = form.description.trim() || null;
      const saved: LaytimeRuleSetRow = {
        id: result.data.id,
        name: savedName,
        description: savedDescription,
      };

      setRows((prev) =>
        editing
          ? prev.map((r) => (r.id === saved.id ? saved : r))
          : [...prev, saved]
      );
      closeForm();
    });
  }

  const columns: Column<LaytimeRuleSetRow>[] = [
    {
      key: "name",
      header: "Rule set",
      sortable: true,
      render: (r) => (
        <Link
          href={`/admin/rule-sets/${r.id}`}
          className="hover:underline"
          style={{ fontWeight: 500, color: "var(--teal)" }}
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: "description",
      header: "Description",
      hideBelow: "md",
      render: (r) =>
        r.description ? (
          <span style={{ color: "var(--ink-soft)" }}>{r.description}</span>
        ) : (
          <span style={{ color: "var(--steel)" }}>—</span>
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
        </div>
      ),
    },
  ];

  const formOpen = creating || editing !== null;

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <PageTitle>Rule sets</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            Reusable laytime semantics — which weekdays and holidays are
            excepted, EIU and weather flags, the working-day window. Contracts
            reference a specific version of a rule set.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add rule set
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit ${editing.name}` : "Add a rule set"}
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
                  placeholder="e.g. Gulf SHEX EIU"
                />
              )}
            </Field>

            <Field label="Description" error={fieldErrors.description}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.description}
                  disabled={pending}
                  onChange={(e) => updateField("description", e.target.value)}
                  placeholder="Optional"
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add rule set"}
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
          placeholder="Search rule sets"
          aria-label="Search rule sets"
          className="px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            minWidth: "260px",
          }}
        />
        <span className="text-[12px] ml-auto" style={{ color: "var(--steel)" }}>
          {visible.length} of {rows.length}
        </span>
      </div>

      <DataTable
        caption="Reusable laytime rule sets for this organization"
        columns={columns}
        rows={visible}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No rule sets yet"
              description="Create a rule set, then add versions that hold the actual semantics."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add rule set
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No rule set matches that search"
              description="Try a different name."
            />
          )
        }
      />
    </div>
  );
}