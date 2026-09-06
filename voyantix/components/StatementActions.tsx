"use client";

import { useState, useTransition } from "react";
import { PrimaryButton, SecondaryButton } from "./ui";

type RecalcResult =
  | { kind: "ok"; statementId: string; created: boolean }
  | { kind: "conflict"; count: number }
  | { kind: "error"; message: string };

export function RecalculateButton({ action }: { action: () => Promise<RecalcResult> }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <SecondaryButton
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const r = await action();
            if (r.kind === "ok") {
              setMessage({
                tone: "ok",
                text: r.created ? "Draft statement created." : "Draft statement updated.",
              });
            } else if (r.kind === "conflict") {
              setMessage({
                tone: "bad",
                text: `${r.count} drafts found — nothing was written.`,
              });
            } else {
              setMessage({ tone: "bad", text: r.message });
            }
          })
        }
      >
        {isPending ? "Recalculating…" : "Recalculate"}
      </SecondaryButton>
      {message && (
        <span
          className="text-[11.5px]"
          style={{ color: message.tone === "ok" ? "var(--teal)" : "var(--rust)" }}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

export function FinalizeButton({
  action,
}: {
  action: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return <PrimaryButton onClick={() => setConfirming(true)}>Finalize</PrimaryButton>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[12px]" style={{ color: "var(--steel)" }}>
          Finalize is permanent.
        </span>
        <PrimaryButton
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await action();
              if (!r.ok) setError(r.error);
              else setConfirming(false);
            })
          }
        >
          {isPending ? "Finalizing…" : "Confirm"}
        </PrimaryButton>
        <SecondaryButton onClick={() => setConfirming(false)}>Cancel</SecondaryButton>
      </div>
      {error && (
        <span className="text-[11.5px]" style={{ color: "var(--rust)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
