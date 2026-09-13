import { notFound } from "next/navigation";
import { getContract } from "@/lib/actions/contracts";
import { listLaytimePools } from "@/lib/actions/laytime-pools";
import { ContractDetailScreen } from "@/components/admin/ContractDetailScreen";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const contract = await getContract(id);
  if (!contract.ok) {
    if (contract.code === "NOT_FOUND") notFound();
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div
          role="alert"
          className="rounded-md px-4 py-3 text-[13px]"
          style={{
            background: "var(--rust-soft)",
            border: "1px solid var(--rust)",
            color: "var(--rust)",
          }}
        >
          {contract.message}
        </div>
      </div>
    );
  }

  const pools = await listLaytimePools(id);

  return (
    <ContractDetailScreen
      contractId={id}
      contractReference={contract.data.reference}
      counterparty={contract.data.counterparty}
      initialPools={pools.ok ? pools.data : []}
    />
  );
}