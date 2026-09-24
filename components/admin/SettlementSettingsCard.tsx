"use client";

import { useState, useTransition } from "react";
import { Card, SectionHeading, PrimaryButton } from "@/components/ui";
import { SETTLEMENT_DAY_PRECISIONS } from "@/lib/laytime/settlement";
import { updateSettlementDayPrecision } from "@/lib/actions/settlement-settings";

/**
 * Organization setting: how demurrage/despatch days are rounded before they
 * are multiplied by the rate. Admin page only.
 */
export function SettlementSettingsCard({ initial }: { initial: string }) {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const r = await updateSettlementDayPrecision(value);
      if (r.ok) {
        setSaved(r.data.dayPrecision);
        setMessage({ tone: "ok", text: "Saved. Applies to statements built or rebuilt from now on." });
      } else {
        setMessage({ tone: "error", text: r.message });
      }
    });
  }

  return (
    <Card className="mt-6">
      <SectionHeading>Settlement</SectionHeading>
      <p className="text-[13px] mb-4" style={{ color: "var(--steel)" }}>
        How demurrage and despatch days are rounded before they are multiplied by the rate.
        The amount is always rounded to cents. Finalized statements keep their amounts.
      </p>
      <label htmlFor="settlement-day-precision" className="block text-[12.5px] font-medium mb-1.5" style={{ color: "var(--ink)" }}>
        Day rounding
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <select
          id="settlement-day-precision"
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          className="px-3 py-2 rounded text-[13px] min-w-[280px] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
          style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          {SETTLEMENT_DAY_PRECISIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <PrimaryButton type="button" onClick={save} disabled={pending || value === saved}>
          {pending ? "Saving…" : "Save"}
        </PrimaryButton>
      </div>
      <p className="text-[12px] mt-2" style={{ color: "var(--steel)" }}>
        {value === "EXACT"
          ? "Example: 3.4769735 days × 4,375 = 15,211.76"
          : "Example: 4.7843433 days → 4.78434 × 6,000 = 28,706.04"}
      </p>
      {message && (
        <p
          role="status"
          className="text-[12.5px] mt-2"
          style={{ color: message.tone === "ok" ? "var(--teal)" : "var(--rust)" }}
        >
          {message.text}
        </p>
      )}
    </Card>
  );
}
