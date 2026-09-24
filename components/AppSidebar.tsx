"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";

/**
 * The app frame's left rail. Only routes that exist are listed; items a
 * role cannot open are left out rather than shown and refused.
 *
 * Active state is longest-prefix: /admin/contracts/42 lights "Contracts",
 * not "Administration", because "/admin/contracts" is the more specific href.
 */
export type SidebarItem = { href: string; label: string; icon: IconName };

type IconName = "dash" | "ship" | "file" | "chart" | "rules" | "db";

const ICONS: Record<IconName, ReactNode> = {
  dash: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  ship: (
    <>
      <path d="M3 17l2 3h14l2-3" />
      <path d="M5 17V11h14v6" />
      <path d="M9 11V6h6v5" />
      <path d="M12 3v3" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
  rules: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  db: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

export function AppSidebar({
  main,
  setup,
  footer,
}: {
  main: SidebarItem[];
  setup: SidebarItem[];
  footer: ReactNode;
}) {
  const pathname = usePathname();
  const all = [...main, ...setup];
  const matches = all
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length);
  const activeHref = matches[0]?.href;

  const renderItem = (i: SidebarItem) => {
    const active = i.href === activeHref;
    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={active ? "page" : undefined}
        className="flex items-center gap-3 h-10 px-3 rounded-[10px] text-[13.5px] font-medium no-underline transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass-light)]"
        style={{
          color: active ? "#fff" : "#b9cacd",
          background: active ? "rgba(233,199,127,.12)" : undefined,
          boxShadow: active ? "inset 2px 0 0 var(--brass-light)" : undefined,
        }}
      >
        <Icon name={i.icon} />
        <span>{i.label}</span>
      </Link>
    );
  };

  return (
    <aside
      className="no-print sticky top-0 h-screen w-[244px] shrink-0 flex flex-col gap-1.5 px-3.5 py-5 relative overflow-hidden"
      style={{ background: "linear-gradient(180deg, var(--navy) 0%, var(--navy-2) 100%)" }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.07,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <Link
        href="/portfolio"
        className="relative flex items-center gap-2.5 px-2 pt-0.5 pb-5 no-underline"
      >
        <BrandMark size={26} />
        <span className="font-display text-[19px] font-bold tracking-[-0.02em] text-white">
          Voyantix
        </span>
      </Link>
      <nav aria-label="Main" className="relative flex flex-col gap-0.5">
        {main.map(renderItem)}
      </nav>
      {setup.length > 0 && (
        <>
          <div
            className="relative px-3 pt-5 pb-2 text-[11px] font-semibold uppercase tracking-[.12em]"
            style={{ color: "#6f8c92" }}
          >
            Setup
          </div>
          <nav aria-label="Setup" className="relative flex flex-col gap-0.5">
            {setup.map(renderItem)}
          </nav>
        </>
      )}
      <div className="relative mt-auto">{footer}</div>
    </aside>
  );
}
