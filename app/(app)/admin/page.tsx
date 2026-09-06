import { authorized } from "@/lib/auth/authorized";
import { PageTitle, EmptyState, Card, SectionHeading } from "@/components/ui";
import { permissionsFor } from "@/lib/auth/permissions";

export default async function AdminPage() {
  const ctx = await authorized("admin.configuration", async (c) => c);
  const perms = permissionsFor(ctx.role);

  return (
    <div className="max-w-4xl w-full mx-auto px-8 py-8">
      <PageTitle>Administration</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        {ctx.organizationName}
      </p>

      <Card className="mb-6">
        <SectionHeading>Your access</SectionHeading>
        <p className="text-[13px] mb-3" style={{ color: "var(--steel)" }}>
          Role: <strong style={{ color: "var(--ink)" }}>{ctx.role}</strong>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {perms.map((p) => (
            <span
              key={p}
              className="text-[11px] px-2 py-0.5 rounded font-mono"
              style={{ background: "var(--line-soft)", color: "var(--ink-soft)" }}
            >
              {p}
            </span>
          ))}
        </div>
      </Card>

      <EmptyState
        title="Master data management arrives in Phase 2"
        description="Vessels, ports, facilities, cargo, stoppage reasons, holiday calendars and users become self-service — no seed scripts."
      />
    </div>
  );
}
