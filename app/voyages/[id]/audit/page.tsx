import { VoyagePageShell } from "@/components/VoyagePageShell";
import { Card, PageTitle, EmptyState } from "@/components/ui";
import { getAuditLog } from "@/lib/actions/voyages";

const ACTION_LABELS: Record<string, string> = {
  voyage_created: "Voyage created",
  status_changed: "Status changed",
  statement_created: "Draft statement created",
  statement_recalculated: "Statement recalculated",
  finalized: "Statement finalized",
  recalculate_blocked_data_integrity_exception: "Recalculation blocked",
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entries = await getAuditLog(id);

  return (
    <VoyagePageShell voyageId={id} active="audit">
      <PageTitle>Audit Trail</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        Every change to this voyage and its statements, in order.
      </p>

      {entries.length === 0 ? (
        <EmptyState title="No recorded activity yet" />
      ) : (
        <Card className="max-w-3xl">
          <ol className="flex flex-col">
            {entries.map((e, i) => {
              const blocked = e.action.includes("blocked");
              return (
                <li
                  key={e.id}
                  className="py-3 flex gap-4"
                  style={{
                    borderBottom: i === entries.length - 1 ? "none" : "1px solid var(--line-soft)",
                  }}
                >
                  <div
                    className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full"
                    style={{ background: blocked ? "var(--rust)" : "var(--brass)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[13.5px] font-medium"
                      style={{ color: blocked ? "var(--rust)" : "var(--ink)" }}
                    >
                      {ACTION_LABELS[e.action] ?? e.action}
                    </div>
                    {e.summary && (
                      <div className="text-[12px] mt-0.5" style={{ color: "var(--steel)" }}>
                        {e.summary}
                      </div>
                    )}
                  </div>
                  <div className="num text-[12px] shrink-0" style={{ color: "var(--steel)" }}>
                    {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </VoyagePageShell>
  );
}
