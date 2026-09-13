"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  createRuleSetVersion,
  updateRuleSetVersion,
  type RuleSetVersionRow,
  type RuleSetVersionInput,
} from "@/lib/actions/laytime-rule-set-versions";
import { Field, FormError, SubmitButton } from "@/components/forms";
import {
  Card,
  PageTitle,
  SectionHeading,
  SecondaryButton,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

type HolidayCalendarOption = { id: string; name: string };

// 0 = Sunday ... 6 = Saturday. These are DATA — the numbers the customer
// chooses. The engine (Phase 6) decides what any given weekday convention
// means (withheld rule B5); this screen never interprets them.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

type FormState = {
  excludedWeekdays: number[];
  excludeHolidays: boolean;
  eiuApplies: boolean;
  weatherApplies: boolean;
  workingDayStart: string;
  workingDayEnd: string;
  holidayCalendarId: string;
};

const emptyForm: FormState = {
  excludedWeekdays: [],
  excludeHolidays: false,
  eiuApplies: false,
  weatherApplies: false,
  workingDayStart: "",
  workingDayEnd: "",
  holidayCalendarId: "",
};

function summarize(v: RuleSetVersionRow): string {
  const parts: string[] = [];
  if (v.excludedWeekdays.length > 0) {
    const days = v.excludedWeekdays
      .map((d) => WEEKDAYS.find((w) => w.value === d)?.label ?? String(d))
      .join(", ");
    parts.push(`Excludes ${days}`);
  }
  if (v.excludeHolidays) parts.push("Holidays excepted");
  if (v.eiuApplies) parts.push("EIU");
  if (v.weatherApplies) parts.push("Weather");
  if (v.workingDayStart && v.workingDayEnd) {
    parts.push(`${v.workingDayStart}–${v.workingDayEnd}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No exceptions";
}

export function RuleSetDetailScreen({
  ruleSetId,
  ruleSetName,
  initialVersions,
  holidayCalendars,
}: {
  ruleSetId: string;
  ruleSetName: string;
  initialVersions: RuleSetVersionRow[];
  holidayCalendars: HolidayCalendarOption[];
}) {
  const [versions, setVersions] = useState(initialVersions);
  const [editing, setEditing] = useState<RuleSetVersionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setNotice(null);
  }

  function openEdit(v: RuleSetVersionRow) {
    setEditing(v);
    setCreating(false);
    setForm({
      excludedWeekdays: [...v.excludedWeekdays],
      excludeHolidays: v.excludeHolidays,
      eiuApplies: v.eiuApplies,
      weatherApplies: v.weatherApplies,
      workingDayStart: v.workingDayStart ?? "",
      workingDayEnd: v.workingDayEnd ?? "",
      holidayCalendarId: v.holidayCalendarId ?? "",
    });
    setFormError(null);
    setNotice(null);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  }

  function toggleWeekday(day: number) {
    setForm((f) => ({
      ...f,
      excludedWeekdays: f.excludedWeekdays.includes(day)
        ? f.excludedWeekdays.filter((d) => d !== day)
        : [...f.excludedWeekdays, day].sort((a, b) => a - b),
    }));
  }

  async function reload() {
    // After an edit that may have created a new version, re-fetch the list so
    // numbers/order are exact rather than reconstructed on the client.
    const { listRuleSetVersions } = await import(
      "@/lib/actions/laytime-rule-set-versions"
    );
    const r = await listRuleSetVersions(ruleSetId);
    if (r.ok) setVersions(r.data);
  }

  function submit() {
    setFormError(null);
    setNotice(null);

    const input: RuleSetVersionInput = {
      excludedWeekdays: form.excludedWeekdays,
      excludeHolidays: form.excludeHolidays,
      eiuApplies: form.eiuApplies,
      weatherApplies: form.weatherApplies,
      workingDayStart: form.workingDayStart || null,
      workingDayEnd: form.workingDayEnd || null,
      holidayCalendarId: form.holidayCalendarId || null,
    };

    startTransition(async () => {
      const result = editing
        ? await updateRuleSetVersion(editing.id, input)
        : await createRuleSetVersion(ruleSetId, input);

      if (!result.ok) {
        setFormError(result.message);
        return;
      }

      // A referenced version edit creates a NEW version (model B). Tell the
      // user what happened so the new row isn't a surprise.
      if (editing && "created" in result.data && result.data.created) {
        setNotice(
          `That version is in use by a contract term, so a new version (v${result.data.versionNumber}) was created with your changes. The original is unchanged.`
        );
      }

      await reload();
      closeForm();
    });
  }

  const formOpen = creating || editing !== null;

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <Link
        href="/admin/rule-sets"
        className="text-[12.5px] hover:underline"
        style={{ color: "var(--steel)" }}
      >
        ← Rule sets
      </Link>

      <div className="flex items-start justify-between mt-2 mb-6">
        <div>
          <PageTitle>{ruleSetName}</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            Versions of this rule set. A version in use by a contract term is
            immutable — editing it creates a new version instead.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add version
          </SubmitButton>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className="rounded-md px-4 py-3 text-[13px] mb-4"
          style={{
            background: "var(--teal-soft)",
            border: "1px solid var(--teal)",
            color: "var(--teal)",
          }}
        >
          {notice}
        </div>
      )}

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit version ${editing.versionNumber}` : "Add a version"}
          </SectionHeading>

          <FormError message={formError} />

          <Field label="Excluded weekdays">
            {() => (
              <div className="flex flex-wrap gap-2 mt-1">
                {WEEKDAYS.map((w) => {
                  const on = form.excludedWeekdays.includes(w.value);
                  return (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => toggleWeekday(w.value)}
                      disabled={pending}
                      className="px-3 py-1.5 rounded-md text-[12.5px] transition-colors"
                      style={{
                        background: on ? "var(--brass)" : "var(--card)",
                        color: on ? "white" : "var(--ink)",
                        border: `1px solid ${on ? "var(--brass)" : "var(--line)"}`,
                      }}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          <div className="flex flex-col gap-2 mt-3 mb-2">
            {[
              { key: "excludeHolidays", label: "Holidays excepted" },
              { key: "eiuApplies", label: "EIU applies" },
              { key: "weatherApplies", label: "Weather applies" },
            ].map((c) => (
              <label
                key={c.key}
                className="flex items-center gap-2 text-[13px]"
                style={{ color: "var(--ink-soft)" }}
              >
                <input
                  type="checkbox"
                  checked={form[c.key as keyof FormState] as boolean}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [c.key]: e.target.checked }))
                  }
                />
                {c.label}
              </label>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-x-6">
            <Field label="Working day start">
              {(a) => (
                <input
                  {...a}
                  type="time"
                  value={form.workingDayStart}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, workingDayStart: e.target.value }))
                  }
                  className="px-3 py-2 rounded-md text-[13px] w-full"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                  }}
                />
              )}
            </Field>
            <Field label="Working day end">
              {(a) => (
                <input
                  {...a}
                  type="time"
                  value={form.workingDayEnd}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, workingDayEnd: e.target.value }))
                  }
                  className="px-3 py-2 rounded-md text-[13px] w-full"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                  }}
                />
              )}
            </Field>
            <Field label="Holiday calendar">
              {(a) => (
                <select
                  {...a}
                  value={form.holidayCalendarId}
                  disabled={pending}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, holidayCalendarId: e.target.value }))
                  }
                  className="px-3 py-2 rounded-md text-[13px] w-full"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                  }}
                >
                  <option value="">None</option>
                  {holidayCalendars.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-3">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add version"}
            </SubmitButton>
            <SecondaryButton onClick={closeForm} disabled={pending}>
              Cancel
            </SecondaryButton>
          </div>
        </Card>
      )}

      {versions.length === 0 ? (
        <EmptyState
          title="No versions yet"
          description="Add a version to hold this rule set's semantics."
          action={
            <SubmitButton onClick={openCreate} pending={false}>
              Add version
            </SubmitButton>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {versions.map((v) => (
            <Card key={v.id} className="!py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <StatusBadge tone="neutral">v{v.versionNumber}</StatusBadge>
                  <span className="text-[13px]" style={{ color: "var(--ink)" }}>
                    {summarize(v)}
                  </span>
                </div>
                <SecondaryButton
                  onClick={() => openEdit(v)}
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