import Link from "next/link";

type VoyTab =
  | "overview"
  | "cargo"
  | "rates"
  | "stoppages"
  | "timeline"
  | "statement"
  | "audit";

const NAV_ITEMS: { key: VoyTab; label: string; href: string; icon: React.ReactNode }[] = [
  {
    key: "overview",
    label: "Overview",
    href: "overview",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 20l3-11 5-6 5 6 3 11" strokeLinejoin="round" />
        <path d="M4 20h16" />
        <circle cx="12" cy="9" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    key: "cargo",
    label: "Cargo Plan",
    href: "cargo-plan",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="10" width="6" height="6" />
        <rect x="9" y="10" width="6" height="6" />
        <rect x="15" y="10" width="6" height="6" />
        <path d="M3 10l9-6 9 6" />
      </svg>
    ),
  },
  {
    key: "rates",
    label: "Rates & Targets",
    href: "rates",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 15a8 8 0 0 1 16 0" />
        <path d="M12 15l4.5-5.5" />
        <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    key: "stoppages",
    label: "Stoppages",
    href: "stoppages",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="7" r="2.6" />
        <path d="M12 9.6V15M8 20h8M9 15h6l1.5 5h-9z" />
      </svg>
    ),
  },
  {
    key: "timeline",
    label: "Timeline",
    href: "timeline",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="13" r="7.5" />
        <path d="M12 9v4l3 2M10 2h4" />
      </svg>
    ),
  },
  {
    key: "statement",
    label: "Laytime Statement",
    href: "statement",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M15 2v5h5" />
        <circle cx="16" cy="17" r="3" />
        <path d="M14.5 17l1 1 2-2" />
      </svg>
    ),
  },
  {
    key: "audit",
    label: "Audit Trail",
    href: "audit",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M5 3h11l3 3v15H5z" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </svg>
    ),
  },
];

export function VoyageSidebar({
  voyageId,
  voyageReference,
  vesselName,
  active,
}: {
  voyageId: string;
  voyageReference: string;
  vesselName: string;
  active: VoyTab;
}) {
  return (
    <div
      className="w-[220px] shrink-0 flex flex-col py-4 px-3"
      style={{
        background: "linear-gradient(180deg,#123551 0%,#0D2338 100%)",
        color: "#CBDCE6",
      }}
    >
      <Link
        href="/portfolio"
        className="flex items-center gap-1.5 text-[12px] no-underline pb-[14px] px-1.5"
        style={{ color: "#8FAEC0" }}
      >
        ← Portfolio
      </Link>

      <div
        className="px-2 pb-4 mb-2.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}
      >
        <div className="font-mono text-[11.5px]" style={{ color: "#8FAEC0" }}>
          {voyageReference}
        </div>
        <div className="font-display text-[15px] font-medium text-white mt-0.5">
          {vesselName}
        </div>
      </div>

      <nav className="flex flex-col gap-px">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={`/voyages/${voyageId}/${item.href}`}
              className="flex items-center gap-[9px] px-[9px] py-2 rounded-md text-[13px] no-underline"
              style={{
                background: isActive ? "rgba(255,255,255,.075)" : "transparent",
                color: isActive ? "#fff" : "#AFC5D3",
                borderLeft: isActive ? "2px solid var(--brass)" : "2px solid transparent",
              }}
            >
              <span style={{ opacity: 0.85 }}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
