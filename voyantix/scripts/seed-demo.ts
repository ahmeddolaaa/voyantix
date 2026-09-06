/**
 * Demo seed — realistic data for screen recording / product demos.
 *
 * All vessel names, ports, quantities and figures below are INVENTED.
 * No real EZDK commercial data is used anywhere in this file.
 *
 * Produces a portfolio that reads like a live system:
 *   VOY-2601  Cargo Complete  — finalized statement, demurrage exposure
 *   VOY-2602  On Laytime      — draft statement, open stoppage running
 *   VOY-2603  Cargo Complete  — finalized statement, despatch earned
 *   VOY-2604  On Laytime      — fresh voyage, nothing calculated yet
 *
 * Run:  npx tsx scripts/seed-demo.ts
 */

import { db } from "../db/client";
import {
  vessels,
  ports,
  cargos,
  factories,
  stoppageReasons,
  contractTerms,
  voyages,
  cargoPlans,
  shiftPerformances,
  stoppages,
  laytimeStatements,
  timeSheetEntries,
  timeSheetEntryStoppageLinks,
  auditLog,
} from "../db/schema";
import { getDefaultOrganizationId } from "../lib/current-org";
import { recalculateVoyage } from "../lib/recalculate-voyage";
import { eq } from "drizzle-orm";

const id = () => crypto.randomUUID();

async function wipe(orgId: string) {

  await db.delete(timeSheetEntryStoppageLinks).where(eq(timeSheetEntryStoppageLinks.organizationId, orgId));
  await db.delete(timeSheetEntries).where(eq(timeSheetEntries.organizationId, orgId));
  await db.delete(laytimeStatements).where(eq(laytimeStatements.organizationId, orgId));
  await db.delete(auditLog).where(eq(auditLog.organizationId, orgId));
  await db.delete(stoppages).where(eq(stoppages.organizationId, orgId));
  await db.delete(shiftPerformances).where(eq(shiftPerformances.organizationId, orgId));
  await db.delete(cargoPlans).where(eq(cargoPlans.organizationId, orgId));
  await db.delete(voyages).where(eq(voyages.organizationId, orgId));
  await db.delete(contractTerms).where(eq(contractTerms.organizationId, orgId));
  await db.delete(stoppageReasons).where(eq(stoppageReasons.organizationId, orgId));
  await db.delete(factories).where(eq(factories.organizationId, orgId));
  await db.delete(cargos).where(eq(cargos.organizationId, orgId));
  await db.delete(ports).where(eq(ports.organizationId, orgId));
  await db.delete(vessels).where(eq(vessels.organizationId, orgId));

}

async function main() {
  const orgId = await getDefaultOrganizationId();
  await wipe(orgId);

  // --- Reference data ------------------------------------------------------
  const vesselRows = [
    "MV Nile Trader",
    "MV Aegean Spirit",
    "MV Levant Carrier",
    "MV Delta Voyager",
  ].map((name) => ({ id: id(), organizationId: orgId, name }));
  await db.insert(vessels).values(vesselRows);

  const portRows = ["Alexandria", "Iskenderun", "Jebel Ali"].map((name) => ({
    id: id(),
    organizationId: orgId,
    name,
  }));
  await db.insert(ports).values(portRows);

  const cargoRows = ["Iron Ore Pellets", "HRC Coil", "Scrap"].map((name) => ({
    id: id(),
    organizationId: orgId,
    name,
  }));
  await db.insert(cargos).values(cargoRows);

  const factoryRows = ["Plant 1 — Berth 4", "Plant 2 — Berth 7"].map((name) => ({
    id: id(),
    organizationId: orgId,
    name,
  }));
  await db.insert(factories).values(factoryRows);

  const reasonRows = [
    "Weather Delay",
    "Crane Breakdown",
    "Awaiting Trucks",
    "Shift Change",
  ].map((name) => ({ id: id(), organizationId: orgId, name }));
  await db.insert(stoppageReasons).values(reasonRows);

  const termsRows = [
    {
      id: id(),
      organizationId: orgId,
      termsReference: "CP-2026-014",
      portId: portRows[0].id,
      cargoId: cargoRows[0].id,
      allowedLaytimeDays: 4,
      demurrageRatePerDay: 18500,
      despatchRatePerDay: 9250,
    },
    {
      id: id(),
      organizationId: orgId,
      termsReference: "CP-2026-021",
      portId: portRows[1].id,
      cargoId: cargoRows[1].id,
      allowedLaytimeDays: 6,
      demurrageRatePerDay: 14000,
      despatchRatePerDay: 7000,
    },
  ];
  await db.insert(contractTerms).values(termsRows);

  // --- Voyage 1: Cargo Complete, will be FINALIZED (demurrage) --------------
  const v1 = id();
  await db.insert(voyages).values({
    id: v1,
    organizationId: orgId,
    voyageReference: "VOY-2601",
    vesselId: vesselRows[0].id,
    portId: portRows[0].id,
    contractTermsId: termsRows[0].id,
    status: "Cargo Complete",
    arrivalTime: "2026-07-14T04:30:00Z",
    norTender: "2026-07-14T06:00:00Z",
    norAcceptance: "2026-07-14T12:00:00Z",
    sailingTime: "2026-07-20T09:00:00Z",
    createdAt: "2026-07-14T04:30:00Z",
  });

  await db.insert(cargoPlans).values([
    {
      id: id(),
      organizationId: orgId,
      planReference: "CP-001",
      voyageId: v1,
      cargoId: cargoRows[0].id,
      factoryId: factoryRows[0].id,
      quantityMt: 32500,
    },
    {
      id: id(),
      organizationId: orgId,
      planReference: "CP-002",
      voyageId: v1,
      cargoId: cargoRows[0].id,
      factoryId: factoryRows[1].id,
      quantityMt: 12800,
    },
  ]);

  await db.insert(shiftPerformances).values([
    mkShift(orgId, v1, "SP-001", "2026-07-14T14:00:00Z", factoryRows[0].id, cargoRows[0].id, "3", "Discharging", 4200),
    mkShift(orgId, v1, "SP-002", "2026-07-15T06:00:00Z", factoryRows[0].id, cargoRows[0].id, "3", "Discharging", 5100),
    mkShift(orgId, v1, "SP-003", "2026-07-16T06:00:00Z", factoryRows[1].id, cargoRows[0].id, "5", "Discharging", 4850),
    mkShift(orgId, v1, "SP-004", "2026-07-17T18:00:00Z", factoryRows[0].id, cargoRows[0].id, "3", "Discharging", 3900),
    mkShift(orgId, v1, "SP-005", "2026-07-19T06:00:00Z", factoryRows[1].id, cargoRows[0].id, "5", "Discharging", 5400),
  ]);

  await db.insert(stoppages).values([
    mkStop(orgId, v1, "STOP-001", reasonRows[0].id, "2026-07-15T18:00:00Z", "2026-07-16T02:30:00Z"),
    mkStop(orgId, v1, "STOP-002", reasonRows[2].id, "2026-07-17T09:00:00Z", "2026-07-17T13:00:00Z"),
    mkStop(orgId, v1, "STOP-003", reasonRows[1].id, "2026-07-18T11:00:00Z", "2026-07-18T20:00:00Z"),
  ]);

  // --- Voyage 2: On Laytime, DRAFT only, one OPEN stoppage -----------------
  const v2 = id();
  await db.insert(voyages).values({
    id: v2,
    organizationId: orgId,
    voyageReference: "VOY-2602",
    vesselId: vesselRows[1].id,
    portId: portRows[1].id,
    contractTermsId: termsRows[1].id,
    status: "On Laytime",
    arrivalTime: "2026-08-19T22:00:00Z",
    norTender: "2026-08-20T01:00:00Z",
    norAcceptance: "2026-08-20T08:00:00Z",
    sailingTime: null,
    createdAt: "2026-08-19T22:00:00Z",
  });

  await db.insert(cargoPlans).values({
    id: id(),
    organizationId: orgId,
    planReference: "CP-001",
    voyageId: v2,
    cargoId: cargoRows[1].id,
    factoryId: factoryRows[1].id,
    quantityMt: 21400,
  });

  await db.insert(shiftPerformances).values([
    mkShift(orgId, v2, "SP-001", "2026-08-20T14:00:00Z", factoryRows[1].id, cargoRows[1].id, "7", "Loading", 3100),
    mkShift(orgId, v2, "SP-002", "2026-08-21T06:00:00Z", factoryRows[1].id, cargoRows[1].id, "7", "Loading", 3650),
    mkShift(orgId, v2, "SP-003", "2026-08-22T06:00:00Z", factoryRows[1].id, cargoRows[1].id, "7", "Loading", 2900),
  ]);

  await db.insert(stoppages).values([
    mkStop(orgId, v2, "STOP-001", reasonRows[3].id, "2026-08-20T22:00:00Z", "2026-08-20T23:00:00Z"),
    mkStop(orgId, v2, "STOP-002", reasonRows[0].id, "2026-08-22T15:00:00Z", null), // OPEN
  ]);

  // --- Voyage 3: Cargo Complete, FINALIZED (despatch earned) ---------------
  const v3 = id();
  await db.insert(voyages).values({
    id: v3,
    organizationId: orgId,
    voyageReference: "VOY-2603",
    vesselId: vesselRows[2].id,
    portId: portRows[1].id,
    contractTermsId: termsRows[1].id,
    status: "Cargo Complete",
    arrivalTime: "2026-06-02T05:00:00Z",
    norTender: "2026-06-02T07:00:00Z",
    norAcceptance: "2026-06-02T10:00:00Z",
    sailingTime: "2026-06-06T14:00:00Z", // ~4.17d vs 6d allowed -> despatch
    createdAt: "2026-06-02T05:00:00Z",
  });

  await db.insert(cargoPlans).values({
    id: id(),
    organizationId: orgId,
    planReference: "CP-001",
    voyageId: v3,
    cargoId: cargoRows[1].id,
    factoryId: factoryRows[0].id,
    quantityMt: 18200,
  });

  await db.insert(shiftPerformances).values([
    mkShift(orgId, v3, "SP-001", "2026-06-02T14:00:00Z", factoryRows[0].id, cargoRows[1].id, "3", "Loading", 6100),
    mkShift(orgId, v3, "SP-002", "2026-06-03T06:00:00Z", factoryRows[0].id, cargoRows[1].id, "3", "Loading", 6400),
    mkShift(orgId, v3, "SP-003", "2026-06-05T06:00:00Z", factoryRows[0].id, cargoRows[1].id, "3", "Loading", 5700),
  ]);

  await db.insert(stoppages).values(
    mkStop(orgId, v3, "STOP-001", reasonRows[3].id, "2026-06-04T06:00:00Z", "2026-06-04T07:30:00Z")
  );

  // --- Voyage 4: fresh, nothing calculated ---------------------------------
  const v4 = id();
  await db.insert(voyages).values({
    id: v4,
    organizationId: orgId,
    voyageReference: "VOY-2604",
    vesselId: vesselRows[3].id,
    portId: portRows[2].id,
    contractTermsId: termsRows[0].id,
    status: "On Laytime",
    arrivalTime: "2026-08-25T11:00:00Z",
    norTender: "2026-08-25T13:00:00Z",
    norAcceptance: "2026-08-25T17:00:00Z",
    sailingTime: null,
    createdAt: "2026-08-25T11:00:00Z",
  });

  // --- Run the engine, then finalize v1 and v3 -----------------------------
  for (const v of [v1, v2, v3]) {
    const r = await recalculateVoyage(orgId, v);
    if (r.kind !== "ok") console.warn(`  ! recalculation for ${v}: ${r.kind}`);
  }

  for (const v of [v1, v3]) {
    const [draft] = await db
      .select()
      .from(laytimeStatements)
      .where(eq(laytimeStatements.voyageId, v));
    if (draft) {
      await db
        .update(laytimeStatements)
        .set({ lifecycleStatus: "Finalized" })
        .where(eq(laytimeStatements.id, draft.id));
      await db.insert(auditLog).values({
        organizationId: orgId,
        entityType: "LaytimeStatement",
        entityId: draft.id,
        action: "finalized",
        summary: "Statement moved Draft → Finalized.",
      });
    }
  }

  // --- Report --------------------------------------------------------------
  const all = await db.select().from(laytimeStatements).where(eq(laytimeStatements.organizationId, orgId));
  console.log("\nDemo data ready.\n");
  console.log("Portfolio:");
  console.log("  VOY-2601  MV Nile Trader      Alexandria   Cargo Complete");
  console.log("  VOY-2602  MV Aegean Spirit    Iskenderun   On Laytime   (open stoppage running)");
  console.log("  VOY-2603  MV Levant Carrier   Iskenderun   Cargo Complete");
  console.log("  VOY-2604  MV Delta Voyager    Jebel Ali    On Laytime   (nothing calculated yet)");
  console.log("\nStatements:");
  for (const s of all) {
    const [v] = await db.select().from(voyages).where(eq(voyages.id, s.voyageId));
    console.log(
      `  ${v.voyageReference}  ${s.lifecycleStatus.padEnd(10)} ` +
        `balance ${s.timeBalanceDays.toFixed(2)}d  ` +
        `${s.settlementType} $${s.settlementAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
    );
  }
  console.log("");
}

function mkShift(
  organizationId: string,
  voyageId: string,
  shiftReference: string,
  shiftDate: string,
  factoryId: string,
  cargoId: string,
  crane: string,
  operationType: string,
  quantityMt: number
) {
  return {
    id: id(),
    organizationId,
    shiftReference,
    voyageId,
    factoryId,
    cargoId,
    shiftDate,
    crane,
    operationType,
    quantityMt,
  };
}

function mkStop(
  organizationId: string,
  voyageId: string,
  stoppageReference: string,
  reasonId: string,
  startTime: string,
  endTime: string | null
) {
  return {
    id: id(),
    organizationId,
    stoppageReference,
    voyageId,
    reasonId,
    startTime,
    endTime,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
