import { authorized } from "@/lib/auth/authorized";
import { ExtractionReview } from "@/components/admin/ExtractionReview";
import type { SofExtraction } from "@/lib/ingestion/schema";
import fixture from "@/lib/ingestion/fixtures/my-fellas-loading.extraction.json";

/**
 * SOF ingestion — review preview.
 *
 * Renders the extraction review experience against the proof-of-concept
 * fixture (MV MY FELLAS loading SOF). This is the review step of the ingestion
 * pipeline; upload + live extraction and commit-to-engine follow as later
 * slices. Gated behind an authenticated session like the rest of the app.
 */
export default async function IngestPreviewPage() {
  await authorized("voyage.read", async (c) => c);
  const extraction = fixture as unknown as SofExtraction;
  return <ExtractionReview extraction={extraction} />;
}
