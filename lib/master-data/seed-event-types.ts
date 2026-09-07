import { db } from "@/db/client";
import {
  operationalEventTypes,
  OPERATIONAL_EVENT_SEMANTICS,
  type OperationalEventSemantic,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * PROTECTED OPERATIONAL EVENT TYPES
 * ---------------------------------------------------------------------------
 * These eight rows are NOT demo data. They are product infrastructure: the
 * laytime engine (Phase 6) resolves commencement, turn time and weather
 * against systemSemantic, so an organization without them cannot calculate
 * at all.
 *
 * This must therefore run for EVERY organization — the demo org created by
 * scripts/bootstrap.ts and every real customer organization created through
 * the administration UI. It is deliberately not inlined into the bootstrap
 * seed, which is support material only.
 *
 * Customers may edit the `label` of these rows (a company may call NOR
 * Acceptance something else). They can never change `code` or
 * `systemSemantic`, deactivate the row, or delete it — enforced by CHECK
 * constraints in db/schema/master-data.ts, not by UI alone.
 * ---------------------------------------------------------------------------
 */

const PROTECTED_EVENT_TYPE_DEFAULTS: ReadonlyArray<{
  semantic: OperationalEventSemantic;
  code: string;
  label: string;
  displayOrder: number;
}> = [
  { semantic: "NOR_TENDERED", code: "nor_tendered", label: "NOR Tendered", displayOrder: 10 },
  { semantic: "NOR_ACCEPTED", code: "nor_accepted", label: "NOR Accepted", displayOrder: 20 },
  { semantic: "BERTHED", code: "berthed", label: "Berthed", displayOrder: 30 },
  { semantic: "OPS_COMMENCED", code: "ops_commenced", label: "Operations Commenced", displayOrder: 40 },
  { semantic: "OPS_COMPLETED", code: "ops_completed", label: "Operations Completed", displayOrder: 50 },
  { semantic: "DEPARTED", code: "departed", label: "Departed", displayOrder: 60 },
  { semantic: "WEATHER_START", code: "weather_start", label: "Weather Stoppage Started", displayOrder: 70 },
  { semantic: "WEATHER_END", code: "weather_end", label: "Weather Stoppage Ended", displayOrder: 80 },
];

// Compile-time guard: if a semantic is ever added to the engine vocabulary
// without a corresponding seed row here, this fails to type-check rather
// than silently shipping an organization the engine cannot serve.
type SeededSemantics = (typeof PROTECTED_EVENT_TYPE_DEFAULTS)[number]["semantic"];
type MissingSemantics = Exclude<OperationalEventSemantic, SeededSemantics>;
const _exhaustive: MissingSemantics extends never ? true : never = true;
void _exhaustive;

export async function seedProtectedEventTypes(
  organizationId: string,
  tx: Pick<typeof db, "select" | "insert"> = db
): Promise<{ created: number; alreadyPresent: number }> {
  const existing = await tx
    .select({ semantic: operationalEventTypes.systemSemantic })
    .from(operationalEventTypes)
    .where(
      and(
        eq(operationalEventTypes.organizationId, organizationId),
        eq(operationalEventTypes.isProtected, true)
      )
    );

  const present = new Set(existing.map((r) => r.semantic));
  const missing = PROTECTED_EVENT_TYPE_DEFAULTS.filter(
    (d) => !present.has(d.semantic)
  );

  if (missing.length === 0) {
    return { created: 0, alreadyPresent: present.size };
  }

  await tx.insert(operationalEventTypes).values(
    missing.map((d) => ({
      organizationId,
      code: d.code,
      label: d.label,
      systemSemantic: d.semantic,
      isProtected: true,
      displayOrder: d.displayOrder,
      status: "active" as const,
    }))
  );

  return { created: missing.length, alreadyPresent: present.size };
}

export { PROTECTED_EVENT_TYPE_DEFAULTS };
