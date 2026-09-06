import Link from "next/link";
import { CompanyBar } from "@/components/CompanyBar";
import { Card, PageTitle, PrimaryButton, StatusBadge, EmptyState } from "@/components/ui";
import { listVoyages } from "@/lib/actions/voyages";

export default async function PortfolioPage() {
  const voyages = await listVoyages();

  return (
    <div className="flex flex-col min-h-screen">
      <CompanyBar active="portfolio" />
      <div className="flex-1 max-w-5xl w-full mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <PageTitle>Portfolio</PageTitle>
          <Link href="/voyages/new">
            <PrimaryButton>+ New Voyage</PrimaryButton>
          </Link>
        </div>

        {voyages.length === 0 ? (
          <EmptyState
            title="No voyages yet"
            description="Create your first voyage to begin tracking laytime."
            action={
              <Link href="/voyages/new">
                <PrimaryButton>+ New Voyage</PrimaryButton>
              </Link>
            }
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th className="text-left px-5 py-3 font-medium" style={{ color: "var(--steel)" }}>
                    Reference
                  </th>
                  <th className="text-left px-5 py-3 font-medium" style={{ color: "var(--steel)" }}>
                    Vessel
                  </th>
                  <th className="text-left px-5 py-3 font-medium" style={{ color: "var(--steel)" }}>
                    Port
                  </th>
                  <th className="text-left px-5 py-3 font-medium" style={{ color: "var(--steel)" }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {voyages.map((v) => (
                  <tr key={v.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                    <td className="px-5 py-3">
                      <Link
                        href={`/voyages/${v.id}/overview`}
                        className="font-mono no-underline hover:underline"
                        style={{ color: "var(--brass)" }}
                      >
                        {v.voyageReference}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{v.vesselName}</td>
                    <td className="px-5 py-3">{v.portName}</td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={v.status === "Cargo Complete" ? "teal" : "brass"}>
                        {v.status}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
