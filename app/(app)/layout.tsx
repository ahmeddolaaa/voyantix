import Link from "next/link";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/session";
import { listMyOrganizations, logout } from "@/lib/actions/auth";
import { BrandMark } from "@/components/BrandMark";
import { NavLink } from "@/components/NavLink";
import { OrgSwitcher } from "@/components/OrgSwitcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const orgs = await listMyOrganizations();

  return (
    <div className="flex flex-col min-h-screen">
      <div
        className="no-print h-[56px] flex items-center gap-[26px] px-[22px] shrink-0"
        style={{ background: "var(--navy)" }}
      >
        <Link href="/portfolio" className="flex items-center gap-[9px] no-underline">
          <BrandMark size={22} />
          <span className="font-display text-[15.5px]" style={{ color: "#F3F7F9" }}>
            Voyantix
          </span>
        </Link>

        <nav className="flex gap-1 ml-2 h-full">
          <NavLink href="/portfolio">Portfolio</NavLink>
          <NavLink href="/admin/voyages">Voyages</NavLink>
          <NavLink href="/reports">Reports</NavLink>
          {ctx.role === "admin" && <NavLink href="/admin">Administration</NavLink>}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <OrgSwitcher
            organizations={orgs}
            activeOrganizationId={ctx.organizationId}
          />
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold"
              style={{ background: "rgba(255,255,255,0.12)", color: "#EAF2F5" }}
              title={ctx.userEmail}
            >
              {initials(ctx.userName)}
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="text-[12px]"
                style={{ color: "#8FAEC0" }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>

      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
