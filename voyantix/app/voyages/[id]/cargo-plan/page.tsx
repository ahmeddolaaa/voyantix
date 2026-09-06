import { VoyagePageShell } from "@/components/VoyagePageShell";
import { Card, PageTitle, PrimaryButton, EmptyState } from "@/components/ui";
import { listCargoPlans, createCargoPlan, deleteCargoPlan, listLookups } from "@/lib/actions/voyages";
import { DeleteButton } from "@/components/DeleteButton";

export default async function CargoPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [plans, { cargos, factories }] = await Promise.all([
    listCargoPlans(id),
    listLookups(),
  ]);

  async function addPlan(formData: FormData) {
    "use server";
    await createCargoPlan(id, formData);
  }

  async function removePlan(planId: string) {
    "use server";
    await deleteCargoPlan(id, planId);
  }

  return (
    <VoyagePageShell voyageId={id} active="cargo">
      <PageTitle>Cargo Plan</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        Planned cargo allocations for this voyage.
      </p>

      <Card className="mb-6">
        <form action={addPlan} className="flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
            Cargo
            <select name="cargoId" required className="input">
              {cargos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
            Factory
            <select name="factoryId" required className="input">
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
            Quantity (MT)
            <input name="quantityMt" type="number" step="0.01" required className="input w-32" />
          </label>
          <PrimaryButton type="submit">Add</PrimaryButton>
        </form>
      </Card>

      {plans.length === 0 ? (
        <EmptyState title="No cargo plan entries yet" description="Add one using the form above." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <Th>Reference</Th>
                <Th>Cargo</Th>
                <Th>Factory</Th>
                <Th>Quantity (MT)</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                  <td className="px-5 py-3 font-mono">{p.planReference}</td>
                  <td className="px-5 py-3">{p.cargoName}</td>
                  <td className="px-5 py-3">{p.factoryName}</td>
                  <td className="px-5 py-3 num">{p.quantityMt.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <DeleteButton action={removePlan.bind(null, p.id)} label="Delete cargo plan entry" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <style>{`.input{border:1px solid var(--line);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--card);color:var(--ink);}`}</style>
    </VoyagePageShell>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left px-5 py-3 font-medium" style={{ color: "var(--steel)" }}>
      {children}
    </th>
  );
}
