import { listStoppageReasons } from "@/lib/actions/stoppage-reasons";
import { StoppageReasonsScreen } from "@/components/admin/StoppageReasonsScreen";

export default async function StoppageReasonsAdminPage() {
  const reasons = await listStoppageReasons({ includeInactive: true });

  if (!reasons.ok) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div
          role="alert"
          className="rounded-md px-4 py-3 text-[13px]"
          style={{
            background: "var(--rust-soft)",
            border: "1px solid var(--rust)",
            color: "var(--rust)",
          }}
        >
          {reasons.message}
        </div>
      </div>
    );
  }

  return <StoppageReasonsScreen initialStoppageReasons={reasons.data} />;
}