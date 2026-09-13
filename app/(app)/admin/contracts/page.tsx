import { listContracts } from "@/lib/actions/contracts";
import { ContractsScreen } from "@/components/admin/ContractsScreen";

export default async function ContractsAdminPage() {
  const contracts = await listContracts({ includeInactive: true });

  if (!contracts.ok) {
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
          {contracts.message}
        </div>
      </div>
    );
  }

  return <ContractsScreen initialContracts={contracts.data} />;
}