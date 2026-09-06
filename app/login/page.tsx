import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/session";
import { LoginForm } from "@/components/LoginForm";
import { BrandMark } from "@/components/BrandMark";

export default async function LoginPage() {
  const ctx = await getTenantContext();
  if (ctx) redirect("/portfolio");

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: "var(--surface)" }}
    >
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <BrandMark size={26} />
          <span
            className="font-display text-[22px]"
            style={{ color: "var(--ink)" }}
          >
            Voyantix
          </span>
        </div>

        <div
          className="rounded-lg p-7"
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            boxShadow:
              "0 1px 2px rgba(19,38,44,.05), 0 10px 28px rgba(19,38,44,.07)",
          }}
        >
          <h1
            className="font-display text-[17px] font-medium mb-1"
            style={{ color: "var(--ink)" }}
          >
            Sign in
          </h1>
          <p className="text-[12.5px] mb-6" style={{ color: "var(--steel)" }}>
            Marine operations — laytime, demurrage and despatch.
          </p>

          <LoginForm />
        </div>
      </div>
    </div>
  );
}
