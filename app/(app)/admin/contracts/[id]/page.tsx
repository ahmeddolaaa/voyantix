import { notFound } from "next/navigation";
import { getContract } from "@/lib/actions/contracts";
import { listContractLaytimeTerms } from "@/lib/actions/contract-laytime-terms";
import { listLaytimeRuleSets } from "@/lib/actions/laytime-rule-sets";
import { listRuleSetVersions } from "@/lib/actions/laytime-rule-set-versions";
import { listLaytimePools } from "@/lib/actions/laytime-pools";
import { listPorts } from "@/lib/actions/ports";
import { listCargoes } from "@/lib/actions/cargoes";
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

  // Load everything the Terms + Pools sections need, in parallel. Ports and
  // cargoes are loaded WITH inactive rows so a term that references a since-
  // deactivated port/cargo can still show its real name during edit; the
  // screen offers only active ones as new choices.
  const [terms, ruleSets, pools, ports, cargoes] = await Promise.all([
    listContractLaytimeTerms(id, { includeInactive: true }),
    listLaytimeRuleSets(),
    listLaytimePools(id),
    listPorts({ includeInactive: true }),
    listCargoes({ includeInactive: true }),
  ]);

  // Flatten rule-set versions into a single option list — no "list all
  // versions" action exists, so compose the existing per-rule-set action.
  const ruleSetList = ruleSets.ok ? ruleSets.data : [];
  const versionLists = await Promise.all(
    ruleSetList.map((rs) => listRuleSetVersions(rs.id))
  );
  const versionOptions = ruleSetList
    .flatMap((rs, i) => {
      const vs = versionLists[i];
      if (!vs.ok) return [];
      return vs.data.map((v) => ({
        id: v.id,
        ruleSetName: rs.name,
        versionNumber: v.versionNumber,
        label: `${rs.name} — v${v.versionNumber}`,
      }));
    })
    .sort((a, b) =>
      a.ruleSetName === b.ruleSetName
        ? b.versionNumber - a.versionNumber
        : a.ruleSetName.localeCompare(b.ruleSetName)
    );

  return (
    <ContractDetailScreen
      contractId={id}
      contractReference={contract.data.reference}
      counterparty={contract.data.counterparty}
      initialPools={pools.ok ? pools.data : []}
      initialTerms={terms.ok ? terms.data : []}
      versionOptions={versionOptions}
      ports={ports.ok ? ports.data.map((p) => ({ id: p.id, name: p.name, status: p.status })) : []}
      cargoes={cargoes.ok ? cargoes.data.map((c) => ({ id: c.id, name: c.name, status: c.status })) : []}
    />
  );
}