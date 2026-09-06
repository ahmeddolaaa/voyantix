"use client";

import { useTransition } from "react";
import { PrimaryButton } from "./ui";

export function CloseStoppageButton({ action }: { action: () => Promise<void> }) {
  const [isPending, startTransition] = useTransition();
  return (
    <PrimaryButton disabled={isPending} onClick={() => startTransition(() => action())}>
      {isPending ? "Closing…" : "Close now"}
    </PrimaryButton>
  );
}
