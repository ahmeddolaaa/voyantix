"use client";

import { useState, useTransition } from "react";

export function DeleteButton({
  action,
  label,
}: {
  action: () => Promise<void>;
  label: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        aria-label={label}
        className="text-[12px] px-2 py-1 rounded"
        style={{ color: "var(--rust)" }}
      >
        Delete
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[12px]" style={{ color: "var(--steel)" }}>
        Sure?
      </span>
      <button
        disabled={isPending}
        onClick={() => startTransition(() => action().then(() => setConfirming(false)))}
        className="text-[12px] px-2 py-1 rounded text-white"
        style={{ background: "var(--rust)" }}
      >
        {isPending ? "Deleting…" : "Delete"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-[12px] px-2 py-1 rounded"
        style={{ color: "var(--steel)" }}
      >
        Cancel
      </button>
    </span>
  );
}
