import Link from "next/link";
import { authorized } from "@/lib/auth/authorized";
import { PageTitle, Card } from "@/components/ui";
import { permissionsFor } from "@/lib/auth/permissions";
import { SettlementSettingsCard } from "@/components/admin/SettlementSettingsCard";
import { loadSettlementDayPrecision } from "@/lib/actions/_settlement-precision";

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
  { label: "Event types", href: "/admin/event-types", summary: "Port-call vocabulary" },
];

const COMMERCIAL_SECTIONS: { label: string; href?: string; summary: string }[] = [
  { label: "Contracts", href: "/admin/contracts", summary: "Fixtures, terms and pools" },
  { label: "Rule sets", href: "/admin/rule-sets", summary: "Reusable laytime semantics" },
];

const SECTION_ICON: Record<string, string> = {
  Ports: "M12 21s-6-5.7-6-11a6 6 0 1112 0c0 5.3-6 11-6 11z M12 8a2 2 0 110 4 2 2 0 010-4z",
  Facilities: "M4 20h16 M7 20V9l5-5 5 5v11 M12 12v4",
  Vessels: "M3 17l2 3h14l2-3 M5 17V11h14v6 M9 11V6h6v5 M12 3v3",
  Cargo: "M3 7l9-4 9 4-9 4-9-4z M3 12l9 4 9-4 M3 17l9 4 9-4",
  "Stoppage reasons": "M6 5h4v14H6z M14 5h4v14h-4z",
  "Holiday calendars": "M3 4h18v17H3z M3 9h18 M8 2v4 M16 2v4",
  "Event types": "M5 21V4 M5 4h11l-2 4 2 4H5",
  Contracts: "M6 3h9l4 4v14H6z M15 3v4h4",
  "Rule sets": "M4 6h16 M4 12h16 M4 18h10",
};

function SectionGrid({ items }: { items: { label: string; href?: string; summary: string }[] }) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map((s) => {
        const body = (
          <>
            <span
              className="w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center"
              style={{ background: "var(--line-soft)", color: "var(--navy)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={SECTION_ICON[s.label] ?? "M4 12h16"} />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[14px] font-semibold" style={{ color: s.href ? "var(--ink)" : "var(--steel)" }}>
                {s.label}
              </span>
              <span className="text-[12.5px]" style={{ color: "var(--steel)" }}>
                {s.href ? s.summary : "Not yet available"}
              </span>
            </span>
          </>
        );
        const cls = "flex items-center gap-3 p-4 rounded-xl no-underline transition-colors";
        const style = { border: "1px solid var(--line)", background: "var(--card)" };
        return s.href ? (
          <Link
            key={s.label}
            href={s.href}
            className={`${cls} hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]`}
            style={style}
          >
            {body}
          </Link>
        ) : (
          <div key={s.label} className={cls} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export default async function AdminPage() {
  const ctx = await authorized("admin.configuration", async (c) => c);
  const perms = permissionsFor(ctx.role);
  const dayPrecision = await loadSettlementDayPrecision(ctx.organizationId);

  return (
    <div className="max-w-[1240px] w-full mx-auto px-6 lg:px-9 py-8 flex flex-col gap-7">
      <div className="flex flex-col gap-1">
        <PageTitle>Master data &amp; settings</PageTitle>
        <p className="m-0 text-[13.5px]" style={{ color: "var(--steel)" }}>
          {ctx.organizationName} · the reference records voyages and contracts are built from, and company settings.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-[18px] font-semibold">Master data</h2>
        <SectionGrid items={MASTER_DATA_SECTIONS} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-[18px] font-semibold">Commercial</h2>
        <SectionGrid items={COMMERCIAL_SECTIONS} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-[18px] font-semibold">Settings</h2>
        <div className="[&>*]:!mt-0">
          <SettlementSettingsCard initial={dayPrecision} />
        </div>
      </section>

      <Card>
        <details>
          <summary className="cursor-pointer text-[14px] font-semibold">
            Your access · {ctx.role}
          </summary>
          <div className="flex flex-wrap gap-1.5 mt-3">
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
        </details>
      </Card>
    </div>
  );
}
