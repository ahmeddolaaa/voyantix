"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/actions/auth";
import { PrimaryButton } from "./ui";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await login(formData);
      if (result.ok) {
        router.push("/portfolio");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span
          className="text-[12px] font-medium"
          style={{ color: "var(--ink-soft)" }}
        >
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="vx-input"
          placeholder="you@company.com"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span
          className="text-[12px] font-medium"
          style={{ color: "var(--ink-soft)" }}
        >
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="vx-input"
        />
      </label>

      {error && (
        <div
          className="text-[12.5px] px-3 py-2 rounded"
          style={{ background: "var(--rust-soft)", color: "var(--rust)" }}
          role="alert"
        >
          {error}
        </div>
      )}

      <PrimaryButton type="submit" disabled={isPending} className="mt-1 w-full">
        {isPending ? "Signing in…" : "Sign in"}
      </PrimaryButton>
    </form>
  );
}
