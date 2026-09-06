"use server";

import { db } from "@/db/client";
import {
  voyages,
  vessels,
  ports,
  contractTerms,
  cargos,
  cargoPlans,
  factories,
  shiftPerformances,
  stoppages,
  stoppageReasons,
  laytimeStatements,
  timeSheetEntries,
  auditLog,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getDefaultOrganizationId } from "@/lib/current-org";
import { recalculateVoyage as runRecalculation } from "@/lib/recalculate-voyage";
import {
  getCanonicalFinalizedStatement,
  getActiveDraftStatement,
} from "@/lib/canonical-statement";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function listVoyages() {
  const orgId = await getDefaultOrganizationId();
  return db
    .select({
      id: voyages.id,
      voyageReference: voyages.voyageReference,
      status: voyages.status,
      vesselName: vessels.name,
      portName: ports.name,
    })
    .from(voyages)
    .innerJoin(vessels, eq(voyages.vesselId, vessels.id))
    .innerJoin(ports, eq(voyages.portId, ports.id))
    .where(eq(voyages.organizationId, orgId))
    .orderBy(desc(voyages.createdAt));
}

export async function listLookups() {
  const orgId = await getDefaultOrganizationId();
  const [v, p, c, f, ct, sr] = await Promise.all([
    db.select().from(vessels).where(eq(vessels.organizationId, orgId)),
    db.select().from(ports).where(eq(ports.organizationId, orgId)),
    db.select().from(cargos).where(eq(cargos.organizationId, orgId)),
    db.select().from(factories).where(eq(factories.organizationId, orgId)),
    db.select().from(contractTerms).where(eq(contractTerms.organizationId, orgId)),
    db.select().from(stoppageReasons).where(eq(stoppageReasons.organizationId, orgId)),
  ]);
  return { vessels: v, ports: p, cargos: c, factories: f, contractTerms: ct, stoppageReasons: sr };
}

export async function createVoyage(formData: FormData) {
  const orgId = await getDefaultOrganizationId();
  const id = crypto.randomUUID();

  await db.insert(voyages).values({
    id,
    organizationId: orgId,
    voyageReference: String(formData.get("voyageReference")),
    vesselId: String(formData.get("vesselId")),
    portId: String(formData.get("portId")),
    contractTermsId: (formData.get("contractTermsId") as string) || null,
    status: "On Laytime",
    arrivalTime: (formData.get("arrivalTime") as string) || null,
    norTender: (formData.get("norTender") as string) || null,
    norAcceptance: (formData.get("norAcceptance") as string) || null,
    sailingTime: null,
  });

  await db.insert(auditLog).values({
    organizationId: orgId,
    entityType: "Voyage",
    entityId: id,
    action: "voyage_created",
    summary: `Voyage ${formData.get("voyageReference")} created.`,
  });

  revalidatePath("/portfolio");
  redirect(`/voyages/${id}/overview`);
}

export async function getVoyage(voyageId: string) {
  const orgId = await getDefaultOrganizationId();
  const [voyage] = await db
    .select({
      id: voyages.id,
      voyageReference: voyages.voyageReference,
      status: voyages.status,
      vesselName: vessels.name,
      portName: ports.name,
      arrivalTime: voyages.arrivalTime,
      norTender: voyages.norTender,
      norAcceptance: voyages.norAcceptance,
      sailingTime: voyages.sailingTime,
      contractTermsId: voyages.contractTermsId,
    })
    .from(voyages)
    .innerJoin(vessels, eq(voyages.vesselId, vessels.id))
    .innerJoin(ports, eq(voyages.portId, ports.id))
    .where(and(eq(voyages.id, voyageId), eq(voyages.organizationId, orgId)));
  return voyage ?? null;
}

export async function setVoyageStatus(voyageId: string, status: string) {
  const orgId = await getDefaultOrganizationId();
  await db
    .update(voyages)
    .set({ status })
    .where(and(eq(voyages.id, voyageId), eq(voyages.organizationId, orgId)));

  await db.insert(auditLog).values({
    organizationId: orgId,
    entityType: "Voyage",
    entityId: voyageId,
    action: "status_changed",
    summary: `Status changed to ${status}.`,
  });

  revalidatePath(`/voyages/${voyageId}`);
}

// ---------------------------------------------------------------------------
// Cargo Plan CRUD
// ---------------------------------------------------------------------------

export async function listCargoPlans(voyageId: string) {
  const orgId = await getDefaultOrganizationId();
  return db
    .select({
      id: cargoPlans.id,
      planReference: cargoPlans.planReference,
      cargoName: cargos.name,
      factoryName: factories.name,
      quantityMt: cargoPlans.quantityMt,
    })
    .from(cargoPlans)
    .innerJoin(cargos, eq(cargoPlans.cargoId, cargos.id))
    .innerJoin(factories, eq(cargoPlans.factoryId, factories.id))
    .where(and(eq(cargoPlans.voyageId, voyageId), eq(cargoPlans.organizationId, orgId)));
}

export async function createCargoPlan(voyageId: string, formData: FormData) {
  const orgId = await getDefaultOrganizationId();
  const count = (await listCargoPlans(voyageId)).length;
  await db.insert(cargoPlans).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    planReference: `CP-${String(count + 1).padStart(3, "0")}`,
    voyageId,
    cargoId: String(formData.get("cargoId")),
    factoryId: String(formData.get("factoryId")),
    quantityMt: Number(formData.get("quantityMt")),
  });
  revalidatePath(`/voyages/${voyageId}/cargo-plan`);
}

export async function deleteCargoPlan(voyageId: string, id: string) {
  const orgId = await getDefaultOrganizationId();
  await db
    .delete(cargoPlans)
    .where(and(eq(cargoPlans.id, id), eq(cargoPlans.organizationId, orgId)));
  revalidatePath(`/voyages/${voyageId}/cargo-plan`);
}

// ---------------------------------------------------------------------------
// Shift Performance CRUD (Rates & Targets screen)
// ---------------------------------------------------------------------------

export async function listShiftPerformance(voyageId: string) {
  const orgId = await getDefaultOrganizationId();
  return db
    .select({
      id: shiftPerformances.id,
      shiftReference: shiftPerformances.shiftReference,
      shiftDate: shiftPerformances.shiftDate,
      crane: shiftPerformances.crane,
      operationType: shiftPerformances.operationType,
      quantityMt: shiftPerformances.quantityMt,
      factoryName: factories.name,
    })
    .from(shiftPerformances)
    .innerJoin(factories, eq(shiftPerformances.factoryId, factories.id))
    .where(
      and(
        eq(shiftPerformances.voyageId, voyageId),
        eq(shiftPerformances.organizationId, orgId)
      )
    );
}

export async function createShiftPerformance(voyageId: string, formData: FormData) {
  const orgId = await getDefaultOrganizationId();
  const count = (await listShiftPerformance(voyageId)).length;
  await db.insert(shiftPerformances).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    shiftReference: `SP-${String(count + 1).padStart(3, "0")}`,
    voyageId,
    factoryId: String(formData.get("factoryId")),
    cargoId: String(formData.get("cargoId")),
    shiftDate: String(formData.get("shiftDate")), // required — see schema note
    crane: String(formData.get("crane")),
    operationType: String(formData.get("operationType")),
    quantityMt: Number(formData.get("quantityMt")),
  });
  revalidatePath(`/voyages/${voyageId}/rates`);
}

export async function deleteShiftPerformance(voyageId: string, id: string) {
  const orgId = await getDefaultOrganizationId();
  await db
    .delete(shiftPerformances)
    .where(and(eq(shiftPerformances.id, id), eq(shiftPerformances.organizationId, orgId)));
  revalidatePath(`/voyages/${voyageId}/rates`);
}

// ---------------------------------------------------------------------------
// Stoppages: Field Entry (create/close) + View/Edit/Delete
// ---------------------------------------------------------------------------

export async function listStoppages(voyageId: string) {
  const orgId = await getDefaultOrganizationId();
  return db
    .select({
      id: stoppages.id,
      stoppageReference: stoppages.stoppageReference,
      reasonName: stoppageReasons.name,
      startTime: stoppages.startTime,
      endTime: stoppages.endTime,
    })
    .from(stoppages)
    .innerJoin(stoppageReasons, eq(stoppages.reasonId, stoppageReasons.id))
    .where(and(eq(stoppages.voyageId, voyageId), eq(stoppages.organizationId, orgId)));
}

async function hasOpenStoppage(orgId: string, voyageId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(stoppages)
    .where(and(eq(stoppages.voyageId, voyageId), eq(stoppages.organizationId, orgId)));
  return rows.some((r) => !r.endTime);
}

function overlaps(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null
): boolean {
  const aE = aEnd ?? "9999-12-31T00:00:00Z";
  const bE = bEnd ?? "9999-12-31T00:00:00Z";
  return aStart < bE && bStart < aE;
}

export type FieldEntryResult = { ok: true } | { ok: false; error: string };

export async function createStoppage(
  voyageId: string,
  formData: FormData
): Promise<FieldEntryResult> {
  const orgId = await getDefaultOrganizationId();
  const startTime = String(formData.get("startTime"));
  const endTime = (formData.get("endTime") as string) || null;

  if (await hasOpenStoppage(orgId, voyageId)) {
    return {
      ok: false,
      error:
        "This voyage already has an open stoppage. Close it before starting a new one.",
    };
  }

  const existing = await db
    .select()
    .from(stoppages)
    .where(and(eq(stoppages.voyageId, voyageId), eq(stoppages.organizationId, orgId)));

  if (existing.some((s) => overlaps(startTime, endTime, s.startTime, s.endTime))) {
    return { ok: false, error: "This stoppage overlaps with an existing stoppage." };
  }

  const count = existing.length;
  await db.insert(stoppages).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    stoppageReference: `STOP-${String(count + 1).padStart(3, "0")}`,
    voyageId,
    reasonId: String(formData.get("reasonId")),
    startTime,
    endTime,
  });

  revalidatePath(`/voyages/${voyageId}/stoppages`);
  revalidatePath(`/voyages/${voyageId}/field-entry`);
  return { ok: true };
}

export async function closeStoppage(voyageId: string, id: string) {
  const orgId = await getDefaultOrganizationId();
  await db
    .update(stoppages)
    .set({ endTime: new Date().toISOString() })
    .where(and(eq(stoppages.id, id), eq(stoppages.organizationId, orgId)));
  revalidatePath(`/voyages/${voyageId}/stoppages`);
  revalidatePath(`/voyages/${voyageId}/field-entry`);
}

export async function updateStoppage(voyageId: string, id: string, formData: FormData) {
  const orgId = await getDefaultOrganizationId();
  await db
    .update(stoppages)
    .set({
      reasonId: String(formData.get("reasonId")),
      startTime: String(formData.get("startTime")),
      endTime: (formData.get("endTime") as string) || null,
    })
    .where(and(eq(stoppages.id, id), eq(stoppages.organizationId, orgId)));
  revalidatePath(`/voyages/${voyageId}/stoppages`);
}

export async function deleteStoppage(voyageId: string, id: string) {
  const orgId = await getDefaultOrganizationId();
  await db
    .delete(stoppages)
    .where(and(eq(stoppages.id, id), eq(stoppages.organizationId, orgId)));
  revalidatePath(`/voyages/${voyageId}/stoppages`);
}

// ---------------------------------------------------------------------------
// Timeline (merged read-only view)
// ---------------------------------------------------------------------------

export async function getTimeline(voyageId: string) {
  const orgId = await getDefaultOrganizationId();

  const stoppageEvents = await db
    .select({
      startTime: stoppages.startTime,
      endTime: stoppages.endTime,
      reasonName: stoppageReasons.name,
    })
    .from(stoppages)
    .innerJoin(stoppageReasons, eq(stoppages.reasonId, stoppageReasons.id))
    .where(and(eq(stoppages.voyageId, voyageId), eq(stoppages.organizationId, orgId)));

  const shiftEvents = await db
    .select({
      shiftDate: shiftPerformances.shiftDate,
      operationType: shiftPerformances.operationType,
      quantityMt: shiftPerformances.quantityMt,
      factoryName: factories.name,
    })
    .from(shiftPerformances)
    .innerJoin(factories, eq(shiftPerformances.factoryId, factories.id))
    .where(
      and(
        eq(shiftPerformances.voyageId, voyageId),
        eq(shiftPerformances.organizationId, orgId)
      )
    );

  type Ev = {
    kind: "stoppage" | "shift";
    sortTime: number;
    title: string;
    subtext: string;
    durationText: string;
  };

  const events: Ev[] = [];

  for (const s of stoppageEvents) {
    const durationHrs = s.endTime
      ? (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000
      : null;
    events.push({
      kind: "stoppage",
      sortTime: new Date(s.startTime).getTime(),
      title: s.reasonName,
      subtext: s.endTime
        ? `Ended ${new Date(s.endTime).toLocaleString()}`
        : "Open — In Progress",
      durationText:
        durationHrs === null
          ? "—"
          : durationHrs < 0
            ? "Invalid Duration"
            : `${durationHrs.toFixed(1)} h`,
    });
  }

  for (const s of shiftEvents) {
    events.push({
      kind: "shift",
      sortTime: new Date(s.shiftDate).getTime(),
      title: s.operationType,
      subtext: `${s.quantityMt.toLocaleString()} MT — ${s.factoryName}`,
      durationText: "",
    });
  }

  events.sort((a, b) => a.sortTime - b.sortTime);
  return events;
}

// ---------------------------------------------------------------------------
// Laytime Statement
// ---------------------------------------------------------------------------

export async function getStatementView(voyageId: string) {
  const orgId = await getDefaultOrganizationId();
  const canonical = await getCanonicalFinalizedStatement(orgId, voyageId);
  const draft = await getActiveDraftStatement(orgId, voyageId);

  let entries: (typeof timeSheetEntries.$inferSelect & { reasonName: string | null })[] = [];
  if (canonical.kind === "found") {
    entries = await db
      .select({
        id: timeSheetEntries.id,
        organizationId: timeSheetEntries.organizationId,
        laytimeStatementId: timeSheetEntries.laytimeStatementId,
        startTime: timeSheetEntries.startTime,
        endTime: timeSheetEntries.endTime,
        durationHours: timeSheetEntries.durationHours,
        currentState: timeSheetEntries.currentState,
        countedOrExcluded: timeSheetEntries.countedOrExcluded,
        relatedStoppageId: timeSheetEntries.relatedStoppageId,
        reasonName: stoppageReasons.name,
      })
      .from(timeSheetEntries)
      .leftJoin(stoppages, eq(timeSheetEntries.relatedStoppageId, stoppages.id))
      .leftJoin(stoppageReasons, eq(stoppages.reasonId, stoppageReasons.id))
      .where(eq(timeSheetEntries.laytimeStatementId, canonical.statement.id));
  }

  return { canonical, draft, entries };
}

export async function recalculateVoyageAction(voyageId: string) {
  const orgId = await getDefaultOrganizationId();
  const result = await runRecalculation(orgId, voyageId);
  revalidatePath(`/voyages/${voyageId}/statement`);
  revalidatePath(`/voyages/${voyageId}/overview`);
  return result;
}

export async function finalizeStatement(voyageId: string, statementId: string) {
  const orgId = await getDefaultOrganizationId();

  // Re-verify canonical state right before writing (defensive re-check —
  // never trust that nothing changed between page render and this action).
  const finalizedNow = await getCanonicalFinalizedStatement(orgId, voyageId);
  if (finalizedNow.kind !== "none") {
    return {
      ok: false as const,
      error:
        finalizedNow.kind === "found"
          ? "A Finalized Statement already exists for this voyage."
          : "Data Integrity Exception: multiple Finalized Statements already exist.",
    };
  }

  await db
    .update(laytimeStatements)
    .set({ lifecycleStatus: "Finalized", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(laytimeStatements.id, statementId),
        eq(laytimeStatements.organizationId, orgId)
      )
    );

  await db.insert(auditLog).values({
    organizationId: orgId,
    entityType: "LaytimeStatement",
    entityId: statementId,
    action: "finalized",
    summary: "Statement moved Draft → Finalized.",
  });

  revalidatePath(`/voyages/${voyageId}/statement`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Audit Trail
// ---------------------------------------------------------------------------

export async function getAuditLog(voyageId: string) {
  const orgId = await getDefaultOrganizationId();
  // Entries tied directly to the Voyage plus its Statements.
  const voyageEntries = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.organizationId, orgId),
        eq(auditLog.entityType, "Voyage"),
        eq(auditLog.entityId, voyageId)
      )
    );

  const statementRows = await db
    .select({ id: laytimeStatements.id })
    .from(laytimeStatements)
    .where(
      and(eq(laytimeStatements.voyageId, voyageId), eq(laytimeStatements.organizationId, orgId))
    );

  const statementEntries = [];
  for (const s of statementRows) {
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, orgId),
          eq(auditLog.entityType, "LaytimeStatement"),
          eq(auditLog.entityId, s.id)
        )
      );
    statementEntries.push(...rows);
  }

  return [...voyageEntries, ...statementEntries].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );
}
