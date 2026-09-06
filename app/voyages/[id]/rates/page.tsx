import { VoyagePageShell } from "@/components/VoyagePageShell";
import { Card, PageTitle, PrimaryButton, EmptyState, StatusBadge } from "@/components/ui";
import {
  listShiftPerformance,
  createShiftPerformance,
  deleteShiftPerformance,
  listLookups,
} from "@/lib/actions/voyages";
import { DeleteButton } from "@/components/DeleteButton";

export default async function RatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [shifts, { cargos, factories }] = await Promise.all([
    listShiftPerformance(id),
    listLookups(),
  ]);

  async function addShift(formData: FormData) {
    "use server";
    await createShiftPerformance(id, formData);
  }

  async function removeShift(shiftId: string) {
    "use server";
    await deleteShiftPerformance(id, shiftId);
  }

  const totalMt = shifts.reduce((sum, s) => sum + s.quantityMt, 0);

  return (
    <VoyagePageShell voyageId={id} active="rates">
      <PageTitle>Rates &amp; Targets</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        Shift performance records for this voyage.
      </p>

      <Card className="mb-6">
        <form action={addShift} className="flex items-end gap-3 flex-wrap">
          <Field label="Shift Date">
            <input name="shiftDate" type="datetime-local" required className="input" />
          </Field>
          <Field label="Factory">
            <select name="factoryId" required className="input">
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cargo">
            <select name="cargoId" required className="input">
              {cargos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Crane">
            <input name="crane" required className="input w-20" placeholder="5" />
          </Field>
          <Field label="Operation">
            <select name="operationType" required className="input">
              <option value="Loading">Loading</option>
              <option value="Discharging">Discharging</option>
            </select>
          </Field>
          <Field label="Quantity (MT)">
            <input name="quantityMt" type="number" step="0.01" required className="input w-28" />
          </Field>
          <PrimaryButton type="submit">Add shift</PrimaryButton>
        </form>
      </Card>

      {shifts.length === 0 ? (
        <EmptyState
          title="No shift performance recorded"
          description="Add the first shift using the form above."
        />
      ) : (
        <>
          <Card className="p-0 overflow-hidden mb-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <Th>Reference</Th>
                  <Th>Shift Date</Th>
                  <Th>Factory</Th>
                  <Th>Crane</Th>
                  <Th>Operation</Th>
                  <Th>Quantity (MT)</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                    <td className="px-5 py-3 font-mono">{s.shiftReference}</td>
                    <td className="px-5 py-3 num">{new Date(s.shiftDate).toLocaleString()}</td>
                    <td className="px-5 py-3">{s.factoryName}</td>
                    <td className="px-5 py-3 num">{s.crane}</td>
                    <td className="px-5 py-3">{s.operationType}</td>
                    <td className="px-5 py-3 num">{s.quantityMt.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right">
                      <DeleteButton action={removeShift.bind(null, s.id)} label="Delete shift" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex items-center gap-6 text-[13px]">
            <span style={{ color: "var(--steel)" }}>
              Total moved: <span className="num" style={{ color: "var(--ink)" }}>{totalMt.toLocaleString()} MT</span>
            </span>
            <span className="flex items-center gap-2" style={{ color: "var(--steel)" }}>
              Achieved Rate: <StatusBadge tone="neutral">Definition pending</StatusBadge>
            </span>
          </div>
        </>
      )}

      <style>{`.input{border:1px solid var(--line);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--card);color:var(--ink);}`}</style>
    </VoyagePageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
      {label}
      {children}
    </label>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left px-5 py-3 font-medium" style={{ color: "var(--steel)" }}>
      {children}
    </th>
  );
}
