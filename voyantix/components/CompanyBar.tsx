import Link from "next/link";
import { BrandMark } from "./BrandMark";

export function CompanyBar({ active }: { active: "portfolio" | "reports" }) {
  return (
    <div
      className="h-[52px] flex items-center gap-[26px] px-[22px] shrink-0"
      style={{ background: "var(--navy)" }}
    >
      <div className="flex items-center gap-[9px]">
        <BrandMark size={22} />
        <span className="font-display text-[15.5px]" style={{ color: "#F3F7F9" }}>
          Voyantix
        </span>
      </div>

      <nav className="flex gap-1 ml-2">
        <Link
          href="/portfolio"
          className="px-[13px] py-2 rounded-md text-[13px] no-underline"
          style={
            active === "portfolio"
              ? { color: "#fff", background: "rgba(255,255,255,.1)", fontWeight: 500 }
              : { color: "#AFC5D3" }
          }
        >
          Portfolio
        </Link>
        <Link
          href="/reports"
          className="px-[13px] py-2 rounded-md text-[13px] no-underline"
          style={
            active === "reports"
              ? { color: "#fff", background: "rgba(255,255,255,.1)", fontWeight: 500 }
              : { color: "#AFC5D3" }
          }
        >
          Reports
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-[14px]">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-semibold"
            style={{ background: "#1B4661", color: "#CFE0EA" }}
          >
            EZ
          </div>
          <span className="text-[12px]" style={{ color: "#DCE7EE" }}>
            EZDK Steel
          </span>
        </div>
      </div>
    </div>
  );
}
