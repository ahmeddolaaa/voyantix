import { describe, it, expect, beforeAll, vi } from "vitest";

let currentToken: string | undefined;

vi.mock("@/lib/auth/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/session")>(
    "@/lib/auth/session"
  );
  return {
    ...actual,
    requireTenantContext: async () => {
      const ctx = await actual.resolveTenantContext(currentToken);
      if (!ctx) throw new actual.UnauthenticatedError();
      return ctx;
    },
  };
});

import { db } from "@/db/client";
import {
  organizations, users, memberships, ports, contracts,
  laytimeRuleSets, laytimeRuleSetVersions, contractLaytimeTerms,
  operationalEventTypes, operationalEvents, voyages, voyagePortCalls,
  laytimeStatements,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { recalculatePortCall } from "../laytime-calculations";
import {
  buildStatementDraft, finalizeStatement, getStatement,
} from "../laytime-statements";

const stamp = Date.now();
const D = (iso: string) => new Date(iso);

let orgA: string;
let adminUserId: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;
let voyageMain: string;
let voyageEmpty: string;
let termExceed: string;
let termNormal: string;
let typeNor: string;
let typeOps: string;
let portAlex: string;
let seq = 0;

async function makeUser(email: string, org: string, role: "admin" | "viewer") {
  const [u] = await db.insert(users).values({ email, passwordHash: await hashPassword("x"), name: email }).returning();
  await db.insert(memberships).values({ userId: u.id, organizationId: org, role });
  return { id: u.id, token: await createSession(u.id, org) };
}

async function makePortCall(voyageId: string, termId: string): Promise<string> {
  seq += 1;
  const [pc] = await db.insert(voyagePortCalls).values({
    organizationId: orgA, voyageId, portId: portAlex, function: "LOAD",
    sequence: seq, effectiveTimezone: "Africa/Cairo", contractLaytimeTermId: termId,
  }).returning({ id: voyagePortCalls.id });
  return pc.id;
}

async function addEvent(portCallId: string, typeId: string, iso: string) {
  await db.insert(operationalEvents).values({
    organizationId: orgA, portCallId, eventTypeId: typeId, occurredAt: D(iso), recordedByUserId: adminUserId,
  });
}

beforeAll(async () => {
  const [a] = await db.insert(organizations).values({ name: "ST A", slug: `st-a-${stamp}` }).returning();
  const [b] = await db.insert(organizations).values({ name: "ST B", slug: `st-b-${stamp}` }).returning();
  orgA = a.id;
  const admin = await makeUser(`st-admin-${stamp}@x`, orgA, "admin");
  adminUserId = admin.id; adminToken = admin.token;
  viewerToken = (await makeUser(`st-viewer-${stamp}@x`, orgA, "viewer")).token;
  orgBToken = (await makeUser(`st-b-${stamp}@x`, b.id, "admin")).token;

  const [p] = await db.insert(ports).values({
    organizationId: orgA, name: `Alex ${stamp}`, country: "EG", defaultTimezone: "Africa/Cairo",
  }).returning({ id: ports.id });
  portAlex = p.id;

  const [tN] = await db.insert(operationalEventTypes).values({
    organizationId: orgA, code: `NORA-${stamp}`, label: "NOR", systemSemantic: "NOR_ACCEPTED", isProtected: true,
  }).returning({ id: operationalEventTypes.id });
  typeNor = tN.id;
  const [tO] = await db.insert(operationalEventTypes).values({
    organizationId: orgA, code: `OPSC-${stamp}`, label: "OPS", systemSemantic: "OPS_COMPLETED", isProtected: true,
  }).returning({ id: operationalEventTypes.id });
  typeOps = tO.id;

  const [contract] = await db.insert(contracts).values({ organizationId: orgA, reference: `C-${stamp}`, counterparty: "Acme" }).returning({ id: contracts.id });
  const [rs] = await db.insert(laytimeRuleSets).values({ organizationId: orgA, name: `RS-${stamp}` }).returning({ id: laytimeRuleSets.id });
  const [ver] = await db.insert(laytimeRuleSetVersions).values({
    organizationId: orgA, ruleSetId: rs.id, versionNumber: 1,
    excludedWeekdays: [], excludeHolidays: false, eiuApplies: true, weatherApplies: false,
  }).returning({ id: laytimeRuleSetVersions.id });

  const [te] = await db.insert(contractLaytimeTerms).values({
    organizationId: orgA, contractId: contract.id, function: "LOAD",
    allowance: "1", allowanceUnit: "days", demurrageRate: "2000",
    commencementRule: "NOR_ACCEPTED", turnTimeHours: "24", turnTimeTrigger: "NOR_ACCEPTED", ruleSetVersionId: ver.id,
  }).returning({ id: contractLaytimeTerms.id });
  termExceed = te.id;
  const [tn] = await db.insert(contractLaytimeTerms).values({
    organizationId: orgA, contractId: contract.id, function: "LOAD",
    allowance: "10", allowanceUnit: "days", demurrageRate: "1000",
    commencementRule: "NOR_ACCEPTED", turnTimeHours: "24", turnTimeTrigger: "NOR_ACCEPTED", ruleSetVersionId: ver.id,
  }).returning({ id: contractLaytimeTerms.id });
  termNormal = tn.id;

  const [v] = await db.insert(voyages).values({ organizationId: orgA, voyageReference: `V-${stamp}`, vesselName: "MV Main" }).returning({ id: voyages.id });
  voyageMain = v.id;
  const [ve] = await db.insert(voyages).values({ organizationId: orgA, voyageReference: `VE-${stamp}`, vesselName: "MV Empty" }).returning({ id: voyages.id });
  voyageEmpty = ve.id;

  // Main voyage: one exceeded call, one saved call, one refused call.
  currentToken = adminToken;
  const pcExceed = await makePortCall(voyageMain, termExceed);
  await addEvent(pcExceed, typeNor, "2026-06-12T05:00:00Z");
  await addEvent(pcExceed, typeOps, "2026-06-15T05:00:00Z");
  await recalculatePortCall(pcExceed);

  const pcSaved = await makePortCall(voyageMain, termNormal);
  await addEvent(pcSaved, typeNor, "2026-06-12T05:00:00Z");
  await addEvent(pcSaved, typeOps, "2026-06-15T05:00:00Z");
  await recalculatePortCall(pcSaved);

  const pcRefused = await makePortCall(voyageMain, termNormal);
  await addEvent(pcRefused, typeNor, "2026-06-12T05:00:00Z"); // no OPS → refused
  await recalculatePortCall(pcRefused);
});

describe("buildStatementDraft", () => {
  it("rolls up the voyage's calculated port calls with settled amounts", async () => {
    currentToken = adminToken;
    const r = await buildStatementDraft(voyageMain);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.status).toBe("draft");
      expect(r.data.scopeCount).toBe(3);
      expect(r.data.demurrageTotal).toBe(2000); // one call exceeded by 1 day @ 2000
      expect(r.data.despatchTotal).toBe(0);
      expect(r.data.unresolvedCount).toBe(1); // the refused call
    }
  });

  it("is idempotent — a second build reuses the one draft", async () => {
    currentToken = adminToken;
    await buildStatementDraft(voyageMain);
    await buildStatementDraft(voyageMain);
    const drafts = await db
      .select({ id: laytimeStatements.id })
      .from(laytimeStatements)
      .where(
        and(
          eq(laytimeStatements.voyageId, voyageMain),
          eq(laytimeStatements.organizationId, orgA),
          eq(laytimeStatements.status, "draft")
        )
      );
    expect(drafts.length).toBe(1);
  });

  it("returns an empty draft for a voyage with no calculations", async () => {
    currentToken = adminToken;
    const r = await buildStatementDraft(voyageEmpty);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.scopeCount).toBe(0);
  });
});

describe("getStatement", () => {
  it("returns the draft with its scopes and totals", async () => {
    currentToken = adminToken;
    await buildStatementDraft(voyageMain);
    const r = await getStatement(voyageMain);
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      expect(r.data.status).toBe("draft");
      expect(r.data.scopes.length).toBe(3);
      expect(r.data.demurrageTotal).toBe(2000);
      expect(r.data.unresolvedCount).toBe(1);
    } else {
      throw new Error("expected a statement");
    }
  });

  it("returns null when the voyage has no statement", async () => {
    currentToken = adminToken;
    const [v] = await db.insert(voyages).values({ organizationId: orgA, voyageReference: `VN-${stamp}`, vesselName: "MV None" }).returning({ id: voyages.id });
    const r = await getStatement(v.id);
    expect(r.ok && r.data === null).toBe(true);
  });
});

describe("finalizeStatement — canonical lifecycle", () => {
  it("promotes the draft to the canonical finalized statement", async () => {
    currentToken = adminToken;
    const [v] = await db.insert(voyages).values({ organizationId: orgA, voyageReference: `VF-${stamp}`, vesselName: "MV Fin" }).returning({ id: voyages.id });
    const pc = await makePortCall(v.id, termNormal);
    await addEvent(pc, typeNor, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOps, "2026-06-15T05:00:00Z");
    await recalculatePortCall(pc);
    await buildStatementDraft(v.id);

    const fin = await finalizeStatement(v.id);
    expect(fin.ok).toBe(true);
    if (fin.ok) expect(fin.data.status).toBe("finalized");

    const read = await getStatement(v.id);
    if (read.ok && read.data) {
      expect(read.data.status).toBe("finalized");
      expect(read.data.finalizedAt).not.toBeNull();
    } else {
      throw new Error("expected a finalized statement");
    }

    // Canonical: a second finalize is rejected.
    const again = await finalizeStatement(v.id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("CONFLICT");
  });

  it("refuses to finalize when there is no draft", async () => {
    currentToken = adminToken;
    const [v] = await db.insert(voyages).values({ organizationId: orgA, voyageReference: `VD-${stamp}`, vesselName: "MV NoDraft" }).returning({ id: voyages.id });
    const r = await finalizeStatement(v.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_STATE");
  });
});

describe("authorization and tenancy", () => {
  it("a viewer cannot build a statement", async () => {
    currentToken = viewerToken;
    const r = await buildStatementDraft(voyageMain);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });

  it("a viewer can read a statement", async () => {
    currentToken = adminToken;
    await buildStatementDraft(voyageMain);
    currentToken = viewerToken;
    const r = await getStatement(voyageMain);
    expect(r.ok).toBe(true);
  });

  it("another org cannot build a statement for this voyage", async () => {
    currentToken = orgBToken;
    const r = await buildStatementDraft(voyageMain);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});
