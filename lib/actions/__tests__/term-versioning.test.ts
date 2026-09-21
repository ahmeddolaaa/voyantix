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
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { recalculatePortCall } from "../laytime-calculations";
import { buildStatementDraft, finalizeStatement, getStatement } from "../laytime-statements";
import {
  updateContractLaytimeTerm, listContractLaytimeTerms,
  type ContractLaytimeTermInput,
} from "../contract-laytime-terms";

const stamp = Date.now();
const D = (iso: string) => new Date(iso);

let orgA: string;
let adminUserId: string;
let adminToken: string;
let contractId: string;
let verId: string;
let typeNor: string;
let typeOps: string;
let portAlex: string;
let seq = 0;

async function makeUser(email: string, org: string, role: "admin" | "viewer") {
  const [u] = await db.insert(users).values({ email, passwordHash: await hashPassword("x"), name: email }).returning();
  await db.insert(memberships).values({ userId: u.id, organizationId: org, role });
  return { id: u.id, token: await createSession(u.id, org) };
}

function termInput(over: Partial<ContractLaytimeTermInput> = {}): ContractLaytimeTermInput {
  return {
    function: "LOAD", allowance: "1", allowanceUnit: "days", demurrageRate: "2000",
    commencementRule: "NOR_ACCEPTED", turnTimeHours: "24", turnTimeTrigger: "NOR_ACCEPTED",
    ruleSetVersionId: verId, ...over,
  };
}

async function makeTerm(over: Partial<ContractLaytimeTermInput> = {}): Promise<string> {
  const i = termInput(over);
  const [t] = await db.insert(contractLaytimeTerms).values({
    organizationId: orgA, contractId, function: i.function,
    allowance: i.allowance, allowanceUnit: i.allowanceUnit, demurrageRate: i.demurrageRate,
    commencementRule: i.commencementRule, turnTimeHours: i.turnTimeHours,
    turnTimeTrigger: i.turnTimeTrigger, ruleSetVersionId: i.ruleSetVersionId,
  }).returning({ id: contractLaytimeTerms.id });
  return t.id;
}

async function makeVoyageWithCalc(termId: string): Promise<{ voyageId: string; portCallId: string }> {
  seq += 1;
  const [v] = await db.insert(voyages).values({
    organizationId: orgA, voyageReference: `TV-${stamp}-${seq}`, vesselName: "MV Ver",
  }).returning({ id: voyages.id });
  const [pc] = await db.insert(voyagePortCalls).values({
    organizationId: orgA, voyageId: v.id, portId: portAlex, function: "LOAD",
    sequence: 1, effectiveTimezone: "Africa/Cairo", contractLaytimeTermId: termId,
  }).returning({ id: voyagePortCalls.id });
  await db.insert(operationalEvents).values({
    organizationId: orgA, portCallId: pc.id, eventTypeId: typeNor,
    occurredAt: D("2026-06-12T05:00:00Z"), recordedByUserId: adminUserId,
  });
  await db.insert(operationalEvents).values({
    organizationId: orgA, portCallId: pc.id, eventTypeId: typeOps,
    occurredAt: D("2026-06-15T05:00:00Z"), recordedByUserId: adminUserId,
  });
  await recalculatePortCall(pc.id);
  return { voyageId: v.id, portCallId: pc.id };
}

beforeAll(async () => {
  const [a] = await db.insert(organizations).values({ name: "TV A", slug: `tv-a-${stamp}` }).returning();
  orgA = a.id;
  const admin = await makeUser(`tv-admin-${stamp}@x`, orgA, "admin");
  adminUserId = admin.id; adminToken = admin.token;

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
  const [c] = await db.insert(contracts).values({ organizationId: orgA, reference: `C-${stamp}`, counterparty: "Acme" }).returning({ id: contracts.id });
  contractId = c.id;
  const [rs] = await db.insert(laytimeRuleSets).values({ organizationId: orgA, name: `RS-${stamp}` }).returning({ id: laytimeRuleSets.id });
  const [ver] = await db.insert(laytimeRuleSetVersions).values({
    organizationId: orgA, ruleSetId: rs.id, versionNumber: 1,
    excludedWeekdays: [], excludeHolidays: false, eiuApplies: true, weatherApplies: false,
  }).returning({ id: laytimeRuleSetVersions.id });
  verId = ver.id;
});

describe("updateContractLaytimeTerm — no finalized dependency: edits in place", () => {
  it("edits the same row when no finalized statement depends on it", async () => {
    currentToken = adminToken;
    const term = await makeTerm();
    const r = await updateContractLaytimeTerm(term, termInput({ demurrageRate: "3000" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.versioned).toBe(false);
      expect(r.data.id).toBe(term);
    }
    const [row] = await db.select({ rate: contractLaytimeTerms.demurrageRate })
      .from(contractLaytimeTerms).where(eq(contractLaytimeTerms.id, term));
    expect(row.rate).toBe("3000");
  });
});

describe("updateContractLaytimeTerm — finalized dependency: creates a new version (F14)", () => {
  it("versions the term, preserves the old row, repoints the port call, keeps the statement intact", async () => {
    currentToken = adminToken;
    const term = await makeTerm({ allowance: "1", demurrageRate: "2000" });
    const { voyageId, portCallId } = await makeVoyageWithCalc(term);
    await buildStatementDraft(voyageId);
    await finalizeStatement(voyageId);

    // The finalized statement now shows demurrage 2000 (exceeded 1 day @ 2000).
    const before = await getStatement(voyageId);
    const beforeDemurrage = before.ok && before.data ? before.data.demurrageTotal : -1;
    expect(beforeDemurrage).toBe(2000);

    // Edit the term now that it is frozen.
    const r = await updateContractLaytimeTerm(term, termInput({ allowance: "10", demurrageRate: "2000" }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("update failed");
    expect(r.data.versioned).toBe(true);
    expect(r.data.id).not.toBe(term);
    const newId = r.data.id;

    // Old row: intact, superseded by the new one, still allowance 1.
    const [oldRow] = await db.select({
      allowance: contractLaytimeTerms.allowance,
      superseded: contractLaytimeTerms.supersededByTermId,
      version: contractLaytimeTerms.versionNumber,
    }).from(contractLaytimeTerms).where(eq(contractLaytimeTerms.id, term));
    expect(oldRow.allowance).toBe("1");
    expect(oldRow.superseded).toBe(newId);

    // New row: allowance 10, version 2, live.
    const [newRow] = await db.select({
      allowance: contractLaytimeTerms.allowance,
      superseded: contractLaytimeTerms.supersededByTermId,
      version: contractLaytimeTerms.versionNumber,
    }).from(contractLaytimeTerms).where(eq(contractLaytimeTerms.id, newId));
    expect(newRow.allowance).toBe("10");
    expect(newRow.version).toBe(oldRow.version + 1);
    expect(newRow.superseded).toBeNull();

    // The live port call is repointed to the new version.
    const [pc] = await db.select({ termId: voyagePortCalls.contractLaytimeTermId })
      .from(voyagePortCalls).where(eq(voyagePortCalls.id, portCallId));
    expect(pc.termId).toBe(newId);

    // The finalized statement's figure is unchanged (historical integrity).
    const after = await getStatement(voyageId);
    if (after.ok && after.data) expect(after.data.demurrageTotal).toBe(2000);

    // The term list shows only the live version, not the superseded one.
    const list = await listContractLaytimeTerms(contractId);
    if (list.ok) {
      const ids = list.data.map((t) => t.id);
      expect(ids).toContain(newId);
      expect(ids).not.toContain(term);
    }
  });

  it("refuses to edit a superseded version directly", async () => {
    currentToken = adminToken;
    const term = await makeTerm({ allowance: "1" });
    const { voyageId } = await makeVoyageWithCalc(term);
    await buildStatementDraft(voyageId);
    await finalizeStatement(voyageId);
    const first = await updateContractLaytimeTerm(term, termInput({ allowance: "5" }));
    expect(first.ok && first.data.versioned).toBe(true);

    // The original (now superseded) row can't be edited directly.
    const again = await updateContractLaytimeTerm(term, termInput({ allowance: "7" }));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("INVALID_STATE");
  });
});
