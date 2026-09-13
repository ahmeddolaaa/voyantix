import { notFound } from "next/navigation";
import { getLaytimeRuleSet } from "@/lib/actions/laytime-rule-sets";
import { listRuleSetVersions } from "@/lib/actions/laytime-rule-set-versions";
import { listHolidayCalendars } from "@/lib/actions/holiday-calendars";
import { RuleSetDetailScreen } from "@/components/admin/RuleSetDetailScreen";

export default async function RuleSetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ruleSet = await getLaytimeRuleSet(id);
  if (!ruleSet.ok) {
    if (ruleSet.code === "NOT_FOUND") notFound();
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div
          role="alert"
          className="rounded-md px-4 py-3 text-[13px]"
          style={{
            background: "var(--rust-soft)",
            border: "1px solid var(--rust)",
            color: "var(--rust)",
          }}
        >
          {ruleSet.message}
        </div>
      </div>
    );
  }

  const [versions, calendars] = await Promise.all([
    listRuleSetVersions(id),
    listHolidayCalendars({ includeInactive: false }),
  ]);

  return (
    <RuleSetDetailScreen
      ruleSetId={id}
      ruleSetName={ruleSet.data.name}
      initialVersions={versions.ok ? versions.data : []}
      holidayCalendars={
        calendars.ok
          ? calendars.data.map((c) => ({ id: c.id, name: c.name }))
          : []
      }
    />
  );
}