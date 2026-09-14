import { listVoyages } from "@/lib/actions/voyages";
import { listVessels } from "@/lib/actions/vessels";
import { listContracts } from "@/lib/actions/contracts";
import { VoyagesScreen } from "@/components/admin/VoyagesScreen";

export default async function VoyagesAdminPage() {
  const [voyages, vessels, contracts] = await Promise.all([
    listVoyages(),
    listVessels({ includeInactive: true }),
    listContracts({ includeInactive: true }),
  ]);

  if (!voyages.ok) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div
          role="alert"
          className="rounded-md px-4 py-3 text-[13px]"
          style={{
            background: "var(--rust-soft)",
            border: "1px solid var(--rust)",
            color: "var(--rust)",
          }}
        >
          {voyages.message}
        </div>
      </div>
    );
  }

  return (
    <VoyagesScreen
      initialVoyages={voyages.data}
      vessels={
        vessels.ok
          ? vessels.data.map((v) => ({ id: v.id, name: v.name, status: v.status }))
          : []
      }
      contracts={
        contracts.ok
          ? contracts.data.map((c) => ({
              id: c.id,
              reference: c.reference,
              status: c.status,
            }))
          : []
      }
    />
  );
}