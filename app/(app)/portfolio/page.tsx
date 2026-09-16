import Link from "next/link";
import { authorized } from "@/lib/auth/authorized";
import { listVoyages } from "@/lib/actions/voyages";
import { PageTitle, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/forms";

/**
 * Portfolio.
 *
 * A placeholder with a truthful count, not the dashboard. The dense
 * operational dashboard belongs to the Phase 8 UX pass; putting a
 * half-built one here now would only have to be thrown away.
 */
export default async function PortfolioPage() {
  const ctx = await authorized("voyage.read", async (c) => c);
  const voyages = await listVoyages();
  const rows = voyages.ok ? voyages.data : [];
  const active = rows.filter((v) => v.status === "ACTIVE").length;

  return (
    <div className="max-w-5xl w-full mx-auto px-8 py-8">
      <PageTitle>Portfolio</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        {ctx.organizationName} · signed in as {ctx.userName} ({ctx.role})
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="No voyages yet"
          description="A voyage is the operational spine: port calls, cargo, events and stoppages all hang off it."
          action={
            <Link href="/admin/voyages">
              <SubmitButton pending={false}>Go to voyages</SubmitButton>
            </Link>
          }
        />
      ) : (
        <div
          className="rounded-md px-5 py-4"
          style={{ background: "var(--card)", border: "1px solid var(--line)" }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div
                className="text-[22px]"
                style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--ink)" }}
              >
                {active}
                <span className="text-[14px]" style={{ color: "var(--steel)" }}>
                  {" "}
                  of {rows.length}
                </span>
              </div>
              <div className="text-[13px] mt-0.5" style={{ color: "var(--steel)" }}>
                {active === 1 ? "voyage is active" : "voyages are active"}
              </div>
            </div>
            <Link
              href="/admin/voyages"
              className="text-[13px] hover:underline"
              style={{ color: "var(--brass)" }}
            >
              View all voyages →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
