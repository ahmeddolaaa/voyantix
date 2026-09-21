"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Top-nav link with an active state. Active when the current path matches or
 * sits under the link's href (so /admin/voyages/123 keeps "Voyages" active).
 * Active is shown with brighter text and a restrained gold underline.
 */
export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Longest-prefix wins: the Administration root ("/admin") must not light up
  // while under Voyages ("/admin/voyages"), which is the more specific item.
  const underHref = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  const active =
    href === "/admin"
      ? (pathname === "/admin" || pathname.startsWith("/admin/")) &&
        !pathname.startsWith("/admin/voyages")
      : underHref;

  return (
    <Link
      href={href}
      className="relative px-[13px] h-full flex items-center text-[13px] no-underline transition-colors"
      style={{
        color: active ? "#FFFFFF" : "#AFC5D3",
        fontWeight: active ? 600 : 400,
        background: active ? "rgba(255,255,255,0.06)" : "transparent",
      }}
    >
      {children}
      {active && (
        <span
          className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full"
          style={{ background: "var(--gold)" }}
        />
      )}
    </Link>
  );
}
