import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/session";
import { listMyOrganizations, logout } from "@/lib/actions/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { AppSidebar, type SidebarItem } from "@/components/AppSidebar";
import { OrgSwitcher } from "@/components/OrgSwitcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const orgs = await listMyOrganizations();

  const main: SidebarItem[] = [
    { href: "/portfolio", label: "Dashboard", icon: "dash" },
    { href: "/admin/voyages", label: "Voyages", icon: "ship", also: ["/admin/ingest-preview"] },
  ];
  if (hasPermission(ctx, "contract.read")) {
    main.push({ href: "/admin/contracts", label: "Contracts", icon: "file" });
  }
  if (hasPermission(ctx, "report.read")) {
    main.push({ href: "/reports", label: "Reports", icon: "chart" });
  }

  const setup: SidebarItem[] = [];
  if (hasPermission(ctx, "contract.read")) {
    setup.push({ href: "/admin/rule-sets", label: "Rule sets", icon: "rules" });
  }
  if (hasPermission(ctx, "admin.configuration")) {
    setup.push({ href: "/admin", label: "Master data & settings", icon: "db" });
  }

  const footer = (
    <div
      className="flex flex-col gap-3 p-3 rounded-xl"
      style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)" }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-[34px] h-[34px] shrink-0 rounded-[10px] flex items-center justify-center font-display text-[13px] font-bold"
          style={{ background: "var(--brass-light)", color: "var(--navy)" }}
          title={ctx.userEmail}
        >
          {initials(ctx.userName)}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <OrgSwitcher organizations={orgs} activeOrganizationId={ctx.organizationId} />
          <span className="text-[11.5px] truncate" style={{ color: "#8fa7ac" }} title={`${ctx.userName} · ${roleLabel(ctx.role)}`}>
            {ctx.userName}
          </span>
        </div>
      </div>
      <form action={logout}>
        <button
          type="submit"
          className="w-full h-8 rounded-lg text-[12.5px] font-medium transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass-light)]"
          style={{ color: "#b9cacd", border: "1px solid rgba(255,255,255,.12)" }}
        >
          Sign out
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <AppSidebar main={main} setup={setup} footer={footer} />
      <main className="flex-1 min-w-0">{children}</main>
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

function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
