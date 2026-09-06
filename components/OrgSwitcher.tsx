"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchOrganization } from "@/lib/actions/auth";

export function OrgSwitcher({
  organizations,
  activeOrganizationId,
}: {
  organizations: { id: string; name: string; role: string }[];
  activeOrganizationId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const active = organizations.find((o) => o.id === activeOrganizationId);

  // A user belonging to one company sees a label, not a control.
  if (organizations.length <= 1) {
    return (
      <span className="text-[12px]" style={{ color: "#DCE7EE" }}>
        {active?.name ?? ""}
      </span>
    );
  }

  return (
    <select
      value={activeOrganizationId}
      disabled={isPending}
      onChange={(e) => {
        const id = e.target.value;
        startTransition(async () => {
          await switchOrganization(id);
          router.refresh();
        });
      }}
      className="text-[12px] rounded px-2 py-1"
      style={{
        background: "#1B4661",
        color: "#DCE7EE",
        border: "1px solid rgba(255,255,255,.12)",
      }}
      aria-label="Active company"
    >
      {organizations.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
