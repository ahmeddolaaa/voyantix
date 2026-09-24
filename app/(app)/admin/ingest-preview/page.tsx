import { authorized } from "@/lib/auth/authorized";
import { db } from "@/db/client";
import { voyagePortCalls, voyages, ports } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SofImportScreen } from "@/components/admin/SofImportScreen";

/**
 * SOF ingestion — upload, read (Gemini), review, commit. With a `portCall`
 * query param (set by "Import from SOF" on a port call) the commit writes the
 * confirmed facts to that port call and feeds the engine; without it, the
 * page reads and reviews a document without writing anything.
 */
export default async function IngestPage({
  searchParams,
}: {
  searchParams: Promise<{ portCall?: string; voyage?: string }>;
}) {
  const ctx = await authorized("voyage.read", async (c) => c);
  const { portCall, voyage } = await searchParams;

  let contextLabel: string | null = null;
  if (portCall) {
    const [row] = await db
      .select({ vessel: voyages.vesselName, seq: voyagePortCalls.sequence, port: ports.name })
      .from(voyagePortCalls)
      .innerJoin(voyages, and(eq(voyages.id, voyagePortCalls.voyageId), eq(voyages.organizationId, ctx.organizationId)))
      .innerJoin(ports, and(eq(ports.id, voyagePortCalls.portId), eq(ports.organizationId, ctx.organizationId)))
      .where(and(eq(voyagePortCalls.id, portCall), eq(voyagePortCalls.organizationId, ctx.organizationId)));
    if (row) contextLabel = `${row.vessel} · ${row.seq} · ${row.port}`;
  }

  return <SofImportScreen portCallId={portCall} voyageId={voyage} contextLabel={contextLabel} />;
}
