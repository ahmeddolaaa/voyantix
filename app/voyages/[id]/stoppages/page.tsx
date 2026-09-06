import Link from "next/link";
import { VoyagePageShell } from "@/components/VoyagePageShell";
import { Card, PageTitle, EmptyState, StatusBadge, SecondaryButton } from "@/components/ui";
import { listStoppages, deleteStoppage } from "@/lib/actions/voyages";
import { DeleteButton } from "@/components/DeleteButton";

export default async function StoppagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stoppages = await listStoppages(id);

  async function remove(stoppageId: string) {
    "use server";
    await deleteStoppage(id, stoppageId);
  }

  return (
    <VoyagePageShell voyageId={id} active="stoppages">
      <div className="flex items-center justify-between mb-1">
        <PageTitle>Stoppages</PageTitle>
        <Link href={`/voyages/${id}/field-entry`}>
          <SecondaryButton>Go to Field Entry</SecondaryButton>
        </Link>
      </div>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        Review and correct recorded stoppages. New stoppages are recorded from Field Entry.
      </p>

      {stoppages.length === 0 ? (
        <EmptyState
          title="No stoppages recorded"
          description="Record stoppages from the Field Entry screen as they happen."
          action={
            <Link href={`/voyages/${id}/field-entry`}>
              <SecondaryButton>Go to Field Entry</SecondaryButton>
            </Link>
          }
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <Th>Reference</Th>
                <Th>Reason</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th>Duration</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {stoppages.map((s) => {
                const hrs = s.endTime
                  ? (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000
                  : null;
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                    <td className="px-5 py-3 font-mono">{s.stoppageReference}</td>
                    <td className="px-5 py-3">{s.reasonName}</td>
                    <td className="px-5 py-3 num">{new Date(s.startTime).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      {s.endTime ? (
                        <span className="num">{new Date(s.endTime).toLocaleString()}</span>
                      ) : (
                        <StatusBadge tone="rust">Open</StatusBadge>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {hrs === null ? (
                        <span style={{ color: "var(--steel)" }}>—</span>
                      ) : hrs < 0 ? (
                        <StatusBadge tone="rust">Invalid duration</StatusBadge>
                      ) : (
                        <span className="num">{hrs.toFixed(1)} h</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <DeleteButton action={remove.bind(null, s.id)} label="Delete stoppage" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </VoyagePageShell>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left px-5 py-3 font-medium" style={{ color: "var(--steel)" }}>
      {children}
    </th>
  );
}
