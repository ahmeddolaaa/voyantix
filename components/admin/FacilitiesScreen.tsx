"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createFacility,
  updateFacility,
  setFacilityStatus,
  type FacilityRow,
  type PortChoice,
} from "@/lib/actions/facilities";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import {
  Field,
  TextInput,
  Select,
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
 * FACILITIES ADMINISTRATION
 *
 * A facility always belongs to a port, so the port choice is required and
 * the list is grouped by port name. Only active ports are offered for a new
 * facility; when editing, the facility's existing port stays selectable even
 * if it was since deactivated, so an unrelated edit cannot force a move.
 */

type FormState = {
  portId: string;
  name: string;
  code: string;
  type: string;
};

const emptyForm: FormState = { portId: "", name: "", code: "", type: "" };

export function FacilitiesScreen({
  initialFacilities,
  portChoices,
}: {
  initialFacilities: FacilityRow[];
  portChoices: PortChoice[];
}) {
  const [rows, setRows] = useState(initialFacilities);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [sort, setSort] = useState<SortState>({
    key: "portName",
    direction: "asc",
  });

  const [editing, setEditing] = useState<FacilityRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activePorts = portChoices.filter((p) => p.status === "active");

  /**
   * The port list for the open form. When editing a facility whose port is
   * inactive, that port is added back so it remains selectable.
   */
  const portOptions = useMemo(() => {
    const base = activePorts.map((p) => ({ value: p.id, label: p.name }));
    if (editing && !activePorts.some((p) => p.id === editing.portId)) {
      return [
        { value: editing.portId, label: `${editing.portName} (inactive)` },
        ...base,
      ];
    }
    return base;
  }, [portChoices, editing]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((f) => {
      if (!showInactive && f.status === "inactive") return false;
      if (q === "") return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.portName.toLowerCase().includes(q) ||
        (f.code ?? "").toLowerCase().includes(q) ||
        (f.type ?? "").toLowerCase().includes(q)
      );
    });

    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof FacilityRow;
      const av = (a[key] ?? "") as string;
      const bv = (b[key] ?? "") as string;
      const primary = av.localeCompare(bv) * dir;
      // Within one port, keep facilities in a stable readable order.
      return primary !== 0 ? primary : a.name.localeCompare(b.name);
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
    setForm({
      ...emptyForm,
      // With exactly one port there is no choice to make; preselect it.
      portId: activePorts.length === 1 ? activePorts[0].id : "",
    });
    setFieldErrors({});
    setFormError(null);
  }

  function openEdit(f: FacilityRow) {
    setEditing(f);
    setCreating(false);
    setForm({
      portId: f.portId,
      name: f.name,
      code: f.code ?? "",
      type: f.type ?? "",
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
    if (code === "DUPLICATE_NAME") {
      setFieldErrors({ name: message });
    } else if (code === "DUPLICATE_CODE") {
      setFieldErrors({ code: message });
    } else if (code === "NOT_FOUND") {
      // A cross-tenant or removed port resolves here.
      setFieldErrors({ portId: message });
    } else {
      setFormError(message);
    }
  }

  function submit() {
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      const input = {
        portId: form.portId,
        name: form.name,
        code: form.code || null,
        type: form.type || null,
      };

      const result = editing
        ? await updateFacility(editing.id, input)
        : await createFacility(input);

      if (!result.ok) {
        applyFailure(result.code, result.message);
        return;
      }

      const port = portChoices.find((p) => p.id === form.portId);
      const saved: FacilityRow = {
        id: result.data.id,
        name: form.name.trim(),
        code: form.code.trim() || null,
        type: form.type.trim() || null,
        status: editing?.status ?? "active",
        portId: form.portId,
        portName: port?.name ?? editing?.portName ?? "",
        portStatus: port?.status ?? editing?.portStatus ?? "active",
      };

      setRows((prev) =>
        editing
          ? prev.map((f) => (f.id === saved.id ? saved : f))
          : [...prev, saved]
      );
      closeForm();
    });
  }

  function toggleStatus(f: FacilityRow) {
    const next = f.status === "active" ? "inactive" : "active";
    startTransition(async () => {
      const result = await setFacilityStatus(f.id, next);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      if (result.data.changed) {
        setRows((prev) =>
          prev.map((x) => (x.id === f.id ? { ...x, status: next } : x))
        );
      }
    });
  }

  const columns: Column<FacilityRow>[] = [
    {
      key: "portName",
      header: "Port",
      sortable: true,
      render: (f) => (
        <span style={{ color: "var(--ink-soft)" }}>
          {f.portName}
          {f.portStatus === "inactive" && (
            <span style={{ color: "var(--steel)" }}> (inactive)</span>
          )}
        </span>
      ),
    },
    {
      key: "name",
      header: "Facility",
      sortable: true,
      render: (f) => <span style={{ fontWeight: 500 }}>{f.name}</span>,
    },
    {
      key: "code",
      header: "Code",
      hideBelow: "md",
      render: (f) =>
        f.code ? (
          <span className="num">{f.code}</span>
        ) : (
          <span style={{ color: "var(--steel)" }}>—</span>
        ),
    },
    {
      key: "type",
      header: "Type",
      hideBelow: "lg",
      render: (f) =>
        f.type ?? <span style={{ color: "var(--steel)" }}>—</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (f) => (
        <StatusBadge tone={f.status === "active" ? "teal" : "neutral"}>
          {f.status === "active" ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (f) => (
        <div className="inline-flex gap-2">
          <SecondaryButton
            onClick={() => openEdit(f)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            Edit
          </SecondaryButton>
          <SecondaryButton
            onClick={() => toggleStatus(f)}
            disabled={pending}
            className="!px-2.5 !py-1 !text-[12px]"
          >
            {f.status === "active" ? "Deactivate" : "Reactivate"}
          </SecondaryButton>
        </div>
      ),
    },
  ];

  const formOpen = creating || editing !== null;
  const noPorts = activePorts.length === 0;

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <PageTitle>Facilities</PageTitle>
          <p className="text-[13px] mt-1" style={{ color: "var(--steel)" }}>
            Terminals, berths and plants where cargo is worked. Each one
            belongs to a port.
          </p>
        </div>
        {!formOpen && !noPorts && (
          <SubmitButton onClick={openCreate} pending={false}>
            Add facility
          </SubmitButton>
        )}
      </div>

      {noPorts && (
        <div className="mb-6">
          <EmptyState
            title="Add a port first"
            description="A facility sits at a port, so at least one active port has to exist before you can add one."
          />
        </div>
      )}

      {formOpen && (
        <Card className="mb-6">
          <SectionHeading>
            {editing ? `Edit ${editing.name}` : "Add a facility"}
          </SectionHeading>

          <FormError message={formError} />

          <div className="grid md:grid-cols-2 gap-x-6">
            <Field label="Port" required error={fieldErrors.portId}>
              {(a) => (
                <Select
                  {...a}
                  value={form.portId}
                  disabled={pending}
                  placeholder="Select a port"
                  options={portOptions}
                  onChange={(e) => updateField("portId", e.target.value)}
                />
              )}
            </Field>

            <Field label="Facility name" required error={fieldErrors.name}>
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
              label="Code"
              description="Optional. A short operational code, such as T1 or B3."
              error={fieldErrors.code}
            >
              {(a) => (
                <TextInput
                  {...a}
                  value={form.code}
                  disabled={pending}
                  onChange={(e) => updateField("code", e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Type"
              description="Optional. For example terminal, berth or plant."
              error={fieldErrors.type}
            >
              {(a) => (
                <TextInput
                  {...a}
                  value={form.type}
                  disabled={pending}
                  onChange={(e) => updateField("type", e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 mt-2">
            <SubmitButton onClick={submit} pending={pending}>
              {editing ? "Save changes" : "Add facility"}
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
          placeholder="Search facilities"
          aria-label="Search facilities"
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
        caption="Facilities configured for this organization"
        columns={columns}
        rows={visible}
        getRowId={(f) => f.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No facilities yet"
              description="Add the terminals and berths your vessels work at."
              action={
                noPorts ? undefined : (
                  <SubmitButton onClick={openCreate} pending={false}>
                    Add facility
                  </SubmitButton>
                )
              }
            />
          ) : (
            <EmptyState
              title="No facilities match that search"
              description="Try a different name, port or code."
            />
          )
        }
      />
    </div>
  );
}
