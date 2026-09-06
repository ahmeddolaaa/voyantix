import Link from "next/link";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/session";
import { listMyOrganizations, logout } from "@/lib/actions/auth";
import { BrandMark } from "@/components/BrandMark";
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
        className="h-[52px] flex items-center gap-[26px] px-[22px] shrink-0"
        style={{ background: "var(--navy)" }}
      >
        <Link href="/portfolio" className="flex items-center gap-[9px] no-underline">
          <BrandMark size={22} />
          <span className="font-display text-[15.5px]" style={{ color: "#F3F7F9" }}>
            Voyantix
          </span>
        </Link>

        <nav className="flex gap-1 ml-2">
          <NavLink href="/portfolio">Portfolio</NavLink>
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
              className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-semibold"
              style={{ background: "#1B4661", color: "#CFE0EA" }}
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

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-[13px] py-2 rounded-md text-[13px] no-underline"
      style={{ color: "#AFC5D3" }}
    >
      {children}
    </Link>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
