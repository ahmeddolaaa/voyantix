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
    <form action={onSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span
          className="text-[12px] font-semibold"
          style={{ color: "var(--ink-soft)" }}
        >
          Work email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="vx-input h-[46px]"
          placeholder="you@company.com"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span
          className="text-[12px] font-semibold"
          style={{ color: "var(--ink-soft)" }}
        >
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="vx-input h-[46px]"
        />
      </label>

      {error && (
        <div
          className="text-[12.5px] px-3 py-2 rounded-lg"
          style={{ background: "var(--coral-soft)", color: "var(--coral)" }}
          role="alert"
        >
          {error}
        </div>
      )}

      <PrimaryButton type="submit" disabled={isPending} className="mt-1 w-full h-12 text-[15px]">
        {isPending ? "Signing in…" : "Sign in"}
      </PrimaryButton>
    </form>
  );
}
