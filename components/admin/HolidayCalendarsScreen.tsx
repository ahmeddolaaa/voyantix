"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  createHolidayCalendar,
  updateHolidayCalendar,
  setHolidayCalendarStatus,
  type HolidayCalendarRow,
} from "@/lib/actions/holiday-calendars";
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

type FormState = { name: string };
const emptyForm: FormState = { name: "" };

export function HolidayCalendarsScreen({
  initialCalendars,
}: {
  initialCalendars: HolidayCalendarRow[];
}) {
  const [rows, setRows] = useState(initialCalendars);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });

  const [editing, setEditing] = useState<HolidayCalendarRow | null>(null);
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
      return c.name.toLowerCase().includes(q);
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof HolidayCalendarRow;
      const av = (a[key] ?? "") as string;
      const bv = (b[key] ?? "") as string;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, search, showInactive, sort]);

  function updateName(value: string) {
    setForm({ name: value });
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

  function openEdit(c: HolidayCalendarRow) {
    setEditing(c);
    setCreating(false);
    setForm({ name: c.name });
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
      const input = { name: form.name };
      const result = editing
        ? await updateHolidayCalendar(editing.id, input)
        : await createHolidayCalendar(input);

      if (!result.ok) {
        if (result.code === "DUPLICATE_NAME") {
          setFieldErrors({ name: result.message });
        } else {
          setFormError(result.message);
        }
        return;
      }

      const saved: HolidayCalendarRow = {
        id: result.data.id,
        name: form.name.trim(),
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

  function toggleStatus(c: HolidayCalendarRow) {
    const next = c.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setHolidayCalendarStatus(c.id, next);
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

  const columns: Column<HolidayCalendarRow>[] = [
    {
      key: "name",
      header: "Calendar",
      sortable: true,
      render: (c) => (
        <Link
          href={`/admin/holiday-calendars/${c.id}`}
          className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)] rounded"
          style={{ color: "var(--brass)" }}
        >
          {c.name}
        </Link>
      ),
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
            Rename
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
          <PageTitle>Holiday calendars</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            Named sets of non-working days. Open a calendar to manage its days.
          </p>
        </div>
        {!formOpen && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add calendar
          </SubmitButton>
        )}
      </div>

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Rename ${editing.name}` : "Add a holiday calendar"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Calendar name" required error={fieldErrors.name}>
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

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add calendar"}
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
          placeholder="Search calendars"
          aria-label="Search holiday calendars"
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
        caption="Holiday calendars recorded for this organization"
        columns={columns}
        rows={visible}
        getRowId={(c) => c.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No holiday calendars yet"
              description="Add a calendar, then open it to add its non-working days."
              action={
                <SubmitButton onClick={openCreate} pending={false}>
                  Add calendar
                </SubmitButton>
              }
            />
          ) : (
            <EmptyState
              title="No calendar matches that search"
              description="Try a different name."
            />
          )
        }
      />
    </div>
  );
}