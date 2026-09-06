import { VoyagePageShell } from "@/components/VoyagePageShell";
import { Card, PageTitle, StatusBadge, SectionHeading } from "@/components/ui";
import { listStoppages, createStoppage, closeStoppage, listLookups } from "@/lib/actions/voyages";
import { FieldEntryForm } from "@/components/FieldEntryForm";
import { CloseStoppageButton } from "@/components/CloseStoppageButton";

export default async function FieldEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [stoppages, { stoppageReasons }] = await Promise.all([
    listStoppages(id),
    listLookups(),
  ]);

  const open = stoppages.find((s) => !s.endTime);

  async function record(formData: FormData) {
    "use server";
    return createStoppage(id, formData);
  }

  async function close(stoppageId: string) {
    "use server";
    await closeStoppage(id, stoppageId);
  }

  return (
    <VoyagePageShell voyageId={id} active="stoppages">
      <PageTitle>Field Entry</PageTitle>
      <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
        Record stoppages as they happen on the quay.
      </p>

      {open && (
        <Card className="mb-6" >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge tone="rust">Open</StatusBadge>
                <span className="font-medium text-[14px]">{open.reasonName}</span>
              </div>
              <div className="text-[12px] num" style={{ color: "var(--steel)" }}>
                Started {new Date(open.startTime).toLocaleString()}
              </div>
            </div>
            <CloseStoppageButton action={close.bind(null, open.id)} />
          </div>
        </Card>
      )}

      <Card className="max-w-lg">
        <SectionHeading>
          {open ? "Close the open stoppage before recording a new one" : "New stoppage"}
        </SectionHeading>
        {open ? (
          <p className="text-[13px]" style={{ color: "var(--steel)" }}>
            A voyage can only have one open stoppage at a time.
          </p>
        ) : (
          <FieldEntryForm reasons={stoppageReasons} action={record} />
        )}
      </Card>
    </VoyagePageShell>
  );
}
