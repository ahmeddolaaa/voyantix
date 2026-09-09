"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  addHoliday,
  deleteHoliday,
  type HolidayRow,
} from "@/lib/actions/holidays";
import { type HolidayCalendarRow } from "@/lib/actions/holiday-calendars";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import {
  Card,
  PageTitle,
  SectionHeading,
  SecondaryButton,
  DangerButton,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

type FormState = { date: string; label: string };
const emptyForm: FormState = { date: "", label: "" };

export function HolidayCalendarDetailScreen({
  calendar,
  initialDays,
}: {
  calendar: HolidayCalendarRow;
  initialDays: HolidayRow[];
}) {
  const [rows, setRows] = useState(initialDays);
  const [sort, setSort] = useState<SortState>({ key: "date", direction: "asc" });

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const key = sort.key as keyof HolidayRow;
      const av = (a[key] ?? "") as string;
      const bv = (b[key] ?? "") as string;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort]);

  function updateField(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function openAdd() {
    setAdding(true);
    setForm(emptyForm);
    setFieldErrors({});
    setFormError(null);
  }

  function closeAdd() {
    setAdding(false);
    setFieldErrors({});
    setFormError(null);
  }

  function submit() {
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      const result = await addHoliday(calendar.id, {
        date: form.date,
        label: form.label,
      });

      if (!result.ok) {
        if (result.code === "DUPLICATE_NAME") {
          setFieldErrors({ date: "That date is already in this calendar." });
        } else {
          setFormError(result.message);
        }
        return;
      }

      const saved: HolidayRow = {
        id: result.data.id,
        date: form.date,
        label: form.label.trim(),
      };

      setRows((prev) => [...prev, saved]);
      closeAdd();
    });
  }

  function remove(day: HolidayRow) {
    const ok = window.confirm(
      `Remove ${day.label} (${day.date}) from this calendar?`
    );
    if (!ok) return;

    setRemovingId(day.id);
    startTransition(async () => {
      const result = await deleteHoliday(day.id);
      setRemovingId(null);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setRows((prev) => prev.filter((d) => d.id !== day.id));
    });
  }

  const columns: Column<HolidayRow>[] = [
    {
      key: "date",
      header: "Date",
      sortable: true,
      render: (d) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{d.date}</span>
      ),
    },
    {
      key: "label",
      header: "Holiday",
      sortable: true,
      render: (d) => <span style={{ fontWeight: 500 }}>{d.label}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (d) => (
        <DangerButton
          onClick={() => remove(d)}
          disabled={pending}
          className="!px-2.5 !py-1 !text-[12px]"
        >
          {removingId === d.id ? "Removing…" : "Remove"}
        </DangerButton>
      ),
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="mb-2">
        <Link
          href="/admin/holiday-calendars"
          className="text-[12.5px] hover:underline"
          style={{ color: "var(--steel)" }}
        >
          ← Holiday calendars
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <PageTitle>{calendar.name}</PageTitle>
            <StatusBadge tone={calendar.status === "active" ? "teal" : "neutral"}>
              {calendar.status === "active" ? "Active" : "Inactive"}
            </StatusBadge>
          </div>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            The non-working days in this calendar.
          </p>
        </div>
        {!adding && (
          <SubmitButton onClick={openAdd} pending={false}>
            Add day
          </SubmitButton>
        )}
      </div>

      {adding && (
        <Card className="mb-6">
          <SectionHeading>Add a non-working day</SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Date" required error={fieldErrors.date}>
              {(a) => (
                <TextInput
                  {...a}
                  type="date"
                  value={form.date}
                  disabled={pending}
                  onChange={(e) => updateField("date", e.target.value)}
                />
              )}
            </Field>

            <Field label="Holiday" required error={fieldErrors.label}>
              {(a) => (
                <TextInput
                  {...a}
                  value={form.label}
                  disabled={pending}
                  placeholder="e.g. New Year's Day"
                  onChange={(e) => updateField("label", e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              Add day
            </SubmitButton>
            <SecondaryButton onClick={closeAdd} disabled={pending}>
              Cancel
            </SecondaryButton>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-3 mb-3">
        <span className="text-[12px] ml-auto" style={{ color: "var(--steel)" }}>
          {rows.length} {rows.length === 1 ? "day" : "days"}
        </span>
      </div>

      <DataTable
        caption={`Non-working days in ${calendar.name}`}
        columns={columns}
        rows={visible}
        getRowId={(d) => d.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          <EmptyState
            title="No days yet"
            description="Add the non-working days this calendar should apply."
            action={
              <SubmitButton onClick={openAdd} pending={false}>
                Add day
              </SubmitButton>
            }
          />
        }
      />
    </div>
  );
}