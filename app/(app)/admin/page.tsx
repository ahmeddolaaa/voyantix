import Link from "next/link";
import { authorized } from "@/lib/auth/authorized";
import { PageTitle, EmptyState, Card, SectionHeading } from "@/components/ui";
import { permissionsFor } from "@/lib/auth/permissions";

/**
 * Master-data sections, in the order an administrator sets them up: a port
 * has to exist before a facility can sit at one, and a holiday calendar
 * before a port can default to it. Entries without an href are not built
 * yet and are listed rather than hidden, so the shape of the section is
 * visible instead of appearing to be missing.
 */
const MASTER_DATA_SECTIONS: { label: string; href?: string; summary: string }[] = [
  { label: "Ports", href: "/admin/ports", summary: "Locations and local time" },
  { label: "Facilities", href: "/admin/facilities", summary: "Terminals and berths" },
  { label: "Vessels", href: "/admin/vessels", summary: "Optional master records" },
  { label: "Cargo", href: "/admin/cargo", summary: "Commodities carried" },
  { label: "Stoppage reasons", href: "/admin/stoppage-reasons", summary: "Why operations paused" },
  { label: "Holiday calendars", href: "/admin/holiday-calendars", summary: "Non-working days" },
  { label: "Event types", summary: "Operational milestones" },
];

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

      <Card>
        <SectionHeading>Master data</SectionHeading>
        <p className="text-[13px] mb-4" style={{ color: "var(--steel)" }}>
          The reference records voyages and contracts are built from.
        </p>
        <ul className="flex flex-col gap-1">
          {MASTER_DATA_SECTIONS.map((s) =>
            s.href ? (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className="flex items-baseline justify-between py-2.5 px-3 -mx-1 rounded-md transition-colors hover:bg-[var(--line-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]"
                >
                  <span className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                    {s.label}
                  </span>
                  <span className="text-[12px]" style={{ color: "var(--steel)" }}>
                    {s.summary}
                  </span>
                </Link>
              </li>
            ) : (
              <li
                key={s.label}
                className="flex items-baseline justify-between py-2.5 px-3 -mx-1"
              >
                <span className="text-[13px]" style={{ color: "var(--steel)" }}>
                  {s.label}
                </span>
                <span className="text-[11.5px]" style={{ color: "var(--steel)" }}>
                  Not yet available
                </span>
              </li>
            )
          )}
        </ul>
      </Card>
    </div>
  );
}
