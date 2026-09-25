import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getTenantContext } from "@/lib/auth/session";
import { LoginForm } from "@/components/LoginForm";
import { BrandMark } from "@/components/BrandMark";

/**
 * Sign-in. Left: what Voyantix covers (cargo plan, live loading, laytime and
 * claims) on the chart-room panel. Right: the form. The panel is decoration
 * and positioning only — it shows no customer data, since nobody is signed in.
 */
export default async function LoginPage() {
  const ctx = await getTenantContext();
  if (ctx) redirect("/portfolio");

  return (
    <div className="min-h-screen flex" style={{ background: "var(--surface)" }}>
      <section
        className="hidden lg:flex relative overflow-hidden flex-col w-[57%] max-w-[860px] px-16 py-14"
        style={{
          background:
            "radial-gradient(120% 90% at 20% 10%, #15424e 0%, var(--navy) 45%, var(--navy-2) 100%)",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.09,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <svg
          aria-hidden
          className="absolute inset-x-0 top-0 w-full pointer-events-none"
          height="340"
          viewBox="0 0 820 340"
          preserveAspectRatio="none"
        >
          <path
            d="M-20 250 C 180 210, 260 150, 420 170 S 700 100, 860 50"
            fill="none"
            stroke="var(--brass-light)"
            strokeWidth="1.6"
            strokeDasharray="6 8"
            opacity=".7"
          />
          <path
            d="M-20 300 C 200 280, 360 230, 520 245 S 760 180, 860 150"
            fill="none"
            stroke="#fff"
            strokeWidth="1"
            opacity=".18"
          />
        </svg>

        <div className="relative flex items-center gap-2.5">
          <BrandMark size={30} />
          <span className="font-display text-[21px] font-bold tracking-[-0.02em] text-white">
            Voyantix
          </span>
        </div>

        <div className="relative mt-auto flex flex-col gap-6 max-w-[600px]">
          <div
            className="text-[11px] font-semibold uppercase tracking-[.12em]"
            style={{ color: "var(--brass-light)" }}
          >
            Marine operations for bulk exporters
          </div>
          <div className="flex flex-col gap-3.5">
            <h1 className="m-0 font-display text-[52px] leading-[1.04] font-bold text-white">
              From berth to bill — every voyage in one place.
            </h1>
            <p
              className="m-0 font-display text-[24px] leading-[1.3] font-medium"
              style={{ color: "var(--brass-light)" }}
            >
              Live while it loads. Settled when it sails.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 pt-1.5">
            <Pillar
              title="Cargo plan"
              icon={
                <>
                  <path d="M3 7l9-4 9 4-9 4-9-4z" />
                  <path d="M3 12l9 4 9-4" />
                  <path d="M3 17l9 4 9-4" />
                </>
              }
            >
              Planned tonnes by cargo and mill, tracked against what&apos;s on board.
            </Pillar>
            <Pillar
              title="Loading live"
              icon={
                <>
                  <path d="M4 20h16" />
                  <path d="M7 20V9l5-5 5 5v11" />
                  <path d="M12 12v4" />
                </>
              }
            >
              Shift tonnages, cranes and stoppages, updated as the vessel works.
            </Pillar>
            <Pillar
              title="Laytime & claims"
              icon={
                <>
                  <circle cx="12" cy="12" r="8" />
                  <path d="M12 8v4l3 2" />
                </>
              }
            >
              Every minute counted against the charter party, claim ready to send.
            </Pillar>
          </div>
        </div>
      </section>

      <section className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px] flex flex-col gap-6">
          <div className="flex lg:hidden items-center gap-2.5">
            <BrandMark size={28} />
            <span className="font-display text-[20px] font-bold" style={{ color: "var(--navy)" }}>
              Voyantix
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="m-0 font-display text-[30px] font-bold" style={{ color: "var(--navy)" }}>
              Welcome back
            </h2>
            <p className="m-0 text-[14.5px]" style={{ color: "var(--ink-soft)" }}>
              Sign in to your company workspace.
            </p>
          </div>
          <LoginForm />
          <p className="m-0 text-center text-[12.5px]" style={{ color: "var(--steel)" }}>
            Protected workspace · each company sees only its own data
          </p>
        </div>
      </section>
    </div>
  );
}

function Pillar({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-2 px-4 py-3.5 rounded-xl"
      style={{ background: "rgba(6,32,42,.6)", border: "1px solid rgba(255,255,255,.10)" }}
    >
      <div className="flex items-center gap-2">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--brass-light)"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {icon}
        </svg>
        <span className="text-[13.5px] font-semibold text-white">{title}</span>
      </div>
      <span className="text-[12.5px] leading-[1.5]" style={{ color: "#9fb5b9" }}>
        {children}
      </span>
    </div>
  );
}
