import { CompanyBar } from "@/components/CompanyBar";
import { PageTitle, EmptyState } from "@/components/ui";

export default function ReportsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <CompanyBar active="reports" />
      <div className="flex-1 max-w-3xl w-full mx-auto px-8 py-8">
        <PageTitle>Reports</PageTitle>
        <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
          Portfolio-wide reporting across voyages.
        </p>
        <EmptyState
          title="Reporting is not built yet"
          description="Voyage-level figures are available today on each voyage's Laytime Statement. Cross-voyage reports are planned for a later release."
        />
      </div>
    </div>
  );
}
