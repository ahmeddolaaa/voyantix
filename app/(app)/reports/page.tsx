import { authorized } from "@/lib/auth/authorized";
import { PageTitle, EmptyState } from "@/components/ui";

export default async function ReportsPage() {
  await authorized("report.read", async (c) => c);
  return (
    <div className="max-w-4xl w-full mx-auto px-8 py-8">
      <PageTitle>Reports</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        Portfolio-wide reporting across voyages.
      </p>
      <EmptyState
        title="Reporting is not built yet"
        description="Reports are Phase 9 and will be built on persisted engine output only — no fabricated figures."
      />
    </div>
  );
}
