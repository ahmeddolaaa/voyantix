import { listLaytimeRuleSets } from "@/lib/actions/laytime-rule-sets";
import { RuleSetsScreen } from "@/components/admin/RuleSetsScreen";

export default async function RuleSetsAdminPage() {
  const ruleSets = await listLaytimeRuleSets();

  if (!ruleSets.ok) {
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
          {ruleSets.message}
        </div>
      </div>
    );
  }

  return <RuleSetsScreen initialRuleSets={ruleSets.data} />;
}