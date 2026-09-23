import { authorized } from "@/lib/auth/authorized";
import { ExtractionReview } from "@/components/admin/ExtractionReview";
import type { SofExtraction } from "@/lib/ingestion/schema";
import fixture from "@/lib/ingestion/fixtures/my-fellas-loading.extraction.json";

/**
 * SOF ingestion — review.
 *
 * Renders the extraction review against the proof-of-concept fixture. With a
 * `portCall` query param (set by "Import from SOF" on a port call) the Commit
 * button writes the confirmed facts to that port call and feeds the engine;
 * without it, the page is a standalone preview. Live document upload replaces
 * the fixture in a later slice.
 */
export default async function IngestPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ portCall?: string; voyage?: string }>;
}) {
  await authorized("voyage.read", async (c) => c);
  const { portCall, voyage } = await searchParams;
  const extraction = fixture as unknown as SofExtraction;
  return (
    <ExtractionReview
      extraction={extraction}
      portCallId={portCall}
      voyageId={voyage}
    />
  );
}
