import { listCargoes } from "@/lib/actions/cargoes";
import { CargoesScreen } from "@/components/admin/CargoesScreen";

export default async function CargoAdminPage() {
  const cargoes = await listCargoes({ includeInactive: true });

  if (!cargoes.ok) {
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
          {cargoes.message}
        </div>
      </div>
    );
  }

  return <CargoesScreen initialCargoes={cargoes.data} />;
}
