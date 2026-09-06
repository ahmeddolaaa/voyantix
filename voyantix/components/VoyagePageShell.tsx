import { notFound } from "next/navigation";
import { VoyageSidebar } from "./VoyageSidebar";
import { getVoyage } from "@/lib/actions/voyages";

type VoyTab =
  | "overview"
  | "cargo"
  | "rates"
  | "stoppages"
  | "timeline"
  | "statement"
  | "audit";

export async function VoyagePageShell({
  voyageId,
  active,
  children,
}: {
  voyageId: string;
  active: VoyTab;
  children: React.ReactNode;
}) {
  const voyage = await getVoyage(voyageId);
  if (!voyage) notFound();

  return (
    <div className="flex flex-col min-h-screen">
      <div
        className="h-[52px] flex items-center px-[22px] shrink-0"
        style={{ background: "var(--navy)" }}
      >
        <span className="font-display text-[15.5px]" style={{ color: "#F3F7F9" }}>
          Voyantix
        </span>
      </div>
      <div className="flex flex-1 min-h-0">
        <VoyageSidebar
          voyageId={voyage.id}
          voyageReference={voyage.voyageReference}
          vesselName={voyage.vesselName}
          active={active}
        />
        <main className="flex-1 min-w-0 overflow-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

export { getVoyage };
