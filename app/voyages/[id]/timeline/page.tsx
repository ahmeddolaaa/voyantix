import { VoyagePageShell } from "@/components/VoyagePageShell";
import { Card, PageTitle, EmptyState, StatusBadge } from "@/components/ui";
import { getTimeline } from "@/lib/actions/voyages";

export default async function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const events = await getTimeline(id);

  return (
    <VoyagePageShell voyageId={id} active="timeline">
      <PageTitle>Timeline</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        Stoppages and shift performance in chronological order.
      </p>

      {events.length === 0 ? (
        <EmptyState
          title="Nothing on the timeline yet"
          description="Stoppages and shift performance records appear here once recorded."
        />
      ) : (
        <Card className="max-w-3xl">
          <ol className="flex flex-col">
            {events.map((e, i) => (
              <li
                key={i}
                className="flex items-start gap-4 py-3"
                style={{
                  borderBottom: i === events.length - 1 ? "none" : "1px solid var(--line-soft)",
                }}
              >
                <div
                  className="mt-0.5 shrink-0 w-6 h-6 rounded-md flex items-center justify-center"
                  style={{
                    background: e.kind === "stoppage" ? "var(--rust-soft)" : "var(--teal-soft)",
                    color: e.kind === "stoppage" ? "var(--rust)" : "var(--teal)",
                  }}
                >
                  {e.kind === "stoppage" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5l11 7-11 7z" />
                    </svg>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13.5px]">{e.title}</div>
                  <div className="text-[12px] mt-0.5" style={{ color: "var(--steel)" }}>
                    {e.subtext}
                  </div>
                </div>

                <div className="num text-[12px] shrink-0" style={{ color: "var(--steel)" }}>
                  {new Date(e.sortTime).toLocaleString()}
                </div>

                <div className="shrink-0 w-28 text-right">
                  {e.durationText === "Invalid Duration" ? (
                    <StatusBadge tone="rust">Invalid duration</StatusBadge>
                  ) : (
                    <span className="num text-[12.5px]">{e.durationText}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </VoyagePageShell>
  );
}
