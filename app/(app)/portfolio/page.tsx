import { authorized } from "@/lib/auth/authorized";
import { PageTitle, EmptyState } from "@/components/ui";

export default async function PortfolioPage() {
  const ctx = await authorized("voyage.read", async (c) => c);

  return (
    <div className="max-w-5xl w-full mx-auto px-8 py-8">
      <PageTitle>Portfolio</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        {ctx.organizationName} · signed in as {ctx.userName} ({ctx.role})
      </p>
      <EmptyState
        title="Voyages arrive in Phase 4"
        description="The multi-port voyage model is being rebuilt. Authentication, tenancy and authorization (Phase 1) are complete and every screen from here on is built inside that boundary."
      />
    </div>
  );
}
