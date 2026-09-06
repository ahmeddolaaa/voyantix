import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/db/client";
import {
  organizations,
  vessels,
  ports,
  cargos,
  factories,
  contractTerms,
  voyages,
  stoppages,
  stoppageReasons,
  laytimeStatements,
  timeSheetEntries,
  auditLog,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { recalculateVoyage } from "../recalculate-voyage";
import { getActiveDraftStatement } from "../canonical-statement";

/**
 * This test directly reproduces the production incident that shaped
 * Section 3.2/3.3 of the spec: the old Power Automate implementation
 * created a brand-new Laytime Statement (and a brand-new set of Time
 * Sheet Entries) on every single recalculation, with no check for an
 * existing Draft. Running it repeatedly against the same voyage produced
 * 7 duplicate Draft Statements before anyone noticed.
 *
 * If this test ever fails, that exact bug class has come back.
 */

const orgId = crypto.randomUUID();
const voyageId = crypto.randomUUID();
let contractTermsId: string;

beforeAll(async () => {
  await db.insert(organizations).values({ id: orgId, name: "Test Org" });

  const [vessel] = await db
    .insert(vessels)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "MV Test" })
    .returning();
  const [port] = await db
    .insert(ports)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "Test Port" })
    .returning();
  const [cargo] = await db
    .insert(cargos)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "Test Cargo" })
    .returning();
  await db.insert(factories).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    name: "Test Factory",
  });
  const [reason] = await db
    .insert(stoppageReasons)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "Weather Delay" })
    .returning();

  const [terms] = await db
    .insert(contractTerms)
    .values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      termsReference: "TEST-TERMS",
      portId: port.id,
      cargoId: cargo.id,
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 10000,
      despatchRatePerDay: 5000,
    })
    .returning();
  contractTermsId = terms.id;

  await db.insert(voyages).values({
    id: voyageId,
    organizationId: orgId,
    voyageReference: "TEST-VOY-001",
    vesselId: vessel.id,
    portId: port.id,
    contractTermsId,
    status: "On Laytime",
    norAcceptance: "2026-08-01T00:00:00Z",
    sailingTime: "2026-08-05T00:00:00Z", // 4 days -> 1 day demurrage
  });

  await db.insert(stoppages).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    stoppageReference: "TEST-STOP-1",
    voyageId,
    reasonId: reason.id,
    startTime: "2026-08-02T00:00:00Z",
    endTime: "2026-08-02T06:00:00Z",
  });
});

afterAll(async () => {
  // Manual cleanup in FK-safe order (test DB is the real dev DB; do not
  // pollute it with leftover fixture rows).
  await db.delete(auditLog).where(eq(auditLog.organizationId, orgId));
  await db.delete(timeSheetEntries).where(eq(timeSheetEntries.organizationId, orgId));
  await db
    .delete(laytimeStatements)
    .where(eq(laytimeStatements.organizationId, orgId));
  await db.delete(stoppages).where(eq(stoppages.organizationId, orgId));
  await db.delete(voyages).where(eq(voyages.organizationId, orgId));
  await db.delete(contractTerms).where(eq(contractTerms.organizationId, orgId));
  await db.delete(stoppageReasons).where(eq(stoppageReasons.organizationId, orgId));
  await db.delete(factories).where(eq(factories.organizationId, orgId));
  await db.delete(cargos).where(eq(cargos.organizationId, orgId));
  await db.delete(ports).where(eq(ports.organizationId, orgId));
  await db.delete(vessels).where(eq(vessels.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("recalculateVoyage — One Active Draft + no Time Sheet accumulation", () => {
  it("creates exactly one Draft Statement on first recalculation", async () => {
    const result = await recalculateVoyage(orgId, voyageId);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.created).toBe(true);

    const draftLookup = await getActiveDraftStatement(orgId, voyageId);
    expect(draftLookup.kind).toBe("found");
  });

  it("updates the SAME Draft on a second recalculation — no new Statement", async () => {
    const before = await getActiveDraftStatement(orgId, voyageId);
    expect(before.kind).toBe("found");
    const beforeId = before.kind === "found" ? before.statement.id : null;

    const result = await recalculateVoyage(orgId, voyageId);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.created).toBe(false);
    expect(result.statementId).toBe(beforeId);

    const after = await getActiveDraftStatement(orgId, voyageId);
    expect(after.kind).toBe("found");
    if (after.kind === "found") {
      expect(after.statement.id).toBe(beforeId);
    }
  });

  it("does not accumulate Time Sheet Entries across 5 repeated recalculations", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await recalculateVoyage(orgId, voyageId);
      expect(result.kind).toBe("ok");
    }

    const draftLookup = await getActiveDraftStatement(orgId, voyageId);
    expect(draftLookup.kind).toBe("found");
    if (draftLookup.kind !== "found") return;

    const entries = await db
      .select()
      .from(timeSheetEntries)
      .where(eq(timeSheetEntries.laytimeStatementId, draftLookup.statement.id));

    // With one stoppage inside a 4-day window, the engine produces exactly
    // 3 intervals every time (counted-before-threshold, counted-after, plus
    // the excluded stoppage) — NOT 3 * 6 = 18 from six total recalculations.
    expect(entries.length).toBeLessThanOrEqual(4);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("only one Laytime Statement row exists for the voyage after 6 total recalculations", async () => {
    const allStatements = await db
      .select()
      .from(laytimeStatements)
      .where(eq(laytimeStatements.voyageId, voyageId));
    expect(allStatements).toHaveLength(1);
  });
});
