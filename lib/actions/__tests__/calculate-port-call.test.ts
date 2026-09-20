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
  organizations,
  users,
  memberships,
  ports,
  cargoes,
  contracts,
  laytimeRuleSets,
  laytimeRuleSetVersions,
  contractLaytimeTerms,
  operationalEventTypes,
  operationalEvents,
  stoppageReasons,
  stoppages,
  contractStoppageRules,
  voyages,
  voyagePortCalls,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { calculatePortCall } from "../calculate-port-call";

const stamp = Date.now();
const D = (iso: string) => new Date(iso);

let orgA: string;
let adminUserId: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let voyageA: string;
let termDays: string;
let termBadUnit: string;
let reasonRuled: string;
let reasonUnruled: string;

let seq = 0;

async function makeUser(email: string, org: string, role: "admin" | "viewer") {
  const [u] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("x"), name: email })
    .returning();
  await db.insert(memberships).values({ userId: u.id, organizationId: org, role });
  return { id: u.id, token: await createSession(u.id, org) };
}

async function makePortCall(
  portId: string,
  termId: string | null
): Promise<string> {
  seq += 1;
  const [pc] = await db
    .insert(voyagePortCalls)
    .values({
      organizationId: orgA,
      voyageId: voyageA,
      portId,
      function: "LOAD",
      sequence: seq,
      effectiveTimezone: "Africa/Cairo",
      contractLaytimeTermId: termId,
    })
    .returning({ id: voyagePortCalls.id });
  return pc.id;
}

let typeNorAccepted: string;
let typeOpsCompleted: string;
let portAlex: string;

async function addEvent(portCallId: string, typeId: string, iso: string) {
  await db.insert(operationalEvents).values({
    organizationId: orgA,
    portCallId,
    eventTypeId: typeId,
    occurredAt: D(iso),
    recordedByUserId: adminUserId,
  });
}

beforeAll(async () => {
  const [a] = await db.insert(organizations).values({ name: "CPC A", slug: `cpc-a-${stamp}` }).returning();
  const [b] = await db.insert(organizations).values({ name: "CPC B", slug: `cpc-b-${stamp}` }).returning();
  orgA = a.id;

  const admin = await makeUser(`cpc-admin-${stamp}@x`, orgA, "admin");
  adminUserId = admin.id;
  adminToken = admin.token;
  viewerToken = (await makeUser(`cpc-viewer-${stamp}@x`, orgA, "viewer")).token;
  orgBToken = (await makeUser(`cpc-b-${stamp}@x`, b.id, "admin")).token;

  const [p] = await db.insert(ports).values({
    organizationId: orgA, name: `Alexandria ${stamp}`, country: "EG", defaultTimezone: "Africa/Cairo",
  }).returning({ id: ports.id });
  portAlex = p.id;

  const [tNor] = await db.insert(operationalEventTypes).values({
    organizationId: orgA, code: `NORA-${stamp}`, label: "NOR accepted",
    systemSemantic: "NOR_ACCEPTED", isProtected: true,
  }).returning({ id: operationalEventTypes.id });
  typeNorAccepted = tNor.id;

  const [tOps] = await db.insert(operationalEventTypes).values({
    organizationId: orgA, code: `OPSC-${stamp}`, label: "Ops completed",
    systemSemantic: "OPS_COMPLETED", isProtected: true,
  }).returning({ id: operationalEventTypes.id });
  typeOpsCompleted = tOps.id;

  const [cargo] = await db.insert(cargoes).values({ organizationId: orgA, name: `Billets ${stamp}` }).returning({ id: cargoes.id });

  const [contract] = await db.insert(contracts).values({
    organizationId: orgA, reference: `C-${stamp}`, counterparty: "Acme",
  }).returning({ id: contracts.id });

  const [rs] = await db.insert(laytimeRuleSets).values({ organizationId: orgA, name: `RS-${stamp}` }).returning({ id: laytimeRuleSets.id });
  const [ver] = await db.insert(laytimeRuleSetVersions).values({
    organizationId: orgA, ruleSetId: rs.id, versionNumber: 1,
    excludedWeekdays: [], excludeHolidays: false, eiuApplies: true, weatherApplies: false,
  }).returning({ id: laytimeRuleSetVersions.id });

  const [term] = await db.insert(contractLaytimeTerms).values({
    organizationId: orgA, contractId: contract.id, function: "LOAD",
    allowance: "10", allowanceUnit: "days", demurrageRate: "1000",
    commencementRule: "NOR_ACCEPTED", turnTimeHours: "24", turnTimeTrigger: "NOR_ACCEPTED",
    ruleSetVersionId: ver.id, cargoId: cargo.id,
  }).returning({ id: contractLaytimeTerms.id });
  termDays = term.id;

  const [term2] = await db.insert(contractLaytimeTerms).values({
    organizationId: orgA, contractId: contract.id, function: "LOAD",
    allowance: "5", allowanceUnit: "weather working days", demurrageRate: "1000",
    commencementRule: "NOR_ACCEPTED", turnTimeHours: "24", turnTimeTrigger: "NOR_ACCEPTED",
    ruleSetVersionId: ver.id,
  }).returning({ id: contractLaytimeTerms.id });
  termBadUnit = term2.id;

  const [rr] = await db.insert(stoppageReasons).values({ organizationId: orgA, name: `Rain-${stamp}` }).returning({ id: stoppageReasons.id });
  const [ru] = await db.insert(stoppageReasons).values({ organizationId: orgA, name: `Unruled-${stamp}` }).returning({ id: stoppageReasons.id });
  reasonRuled = rr.id;
  reasonUnruled = ru.id;
  await db.insert(contractStoppageRules).values({
    organizationId: orgA, termId: termDays, stoppageReasonId: reasonRuled, countability: "AlwaysExcluded",
  });

  const [v] = await db.insert(voyages).values({
    organizationId: orgA, voyageReference: `V-${stamp}`, vesselName: "Test Vessel",
  }).returning({ id: voyages.id });
  voyageA = v.id;
});

describe("calculatePortCall — a clean call", () => {
  it("derives the window and returns a SAVED balance", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(portAlex, termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");

    const r = await calculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (r.ok && r.data.status === "calculated") {
      expect(r.data.window.start.toISOString()).toBe("2026-06-13T05:00:00.000Z");
      expect(r.data.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
      expect(r.data.allowedSeconds).toBe(10 * 86400);
      expect(r.data.usedSeconds).toBe(2 * 86400);
      expect(r.data.balanceSeconds).toBe(8 * 86400);
      expect(r.data.outcome).toBe("SAVED");
      expect(r.data.intervals.length).toBeGreaterThan(0);
    } else {
      throw new Error("expected a calculated result");
    }
  });
});

describe("calculatePortCall — a ruled stoppage reduces counted time", () => {
  it("subtracts an AlwaysExcluded 3h stoppage", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(portAlex, termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");
    await db.insert(stoppages).values({
      organizationId: orgA, portCallId: pc, reasonId: reasonRuled,
      startTime: D("2026-06-14T02:00:00Z"), endTime: D("2026-06-14T05:00:00Z"),
      recordedByUserId: adminUserId,
    });

    const r = await calculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (r.ok && r.data.status === "calculated") {
      expect(r.data.usedSeconds).toBe(2 * 86400 - 3 * 3600);
    } else {
      throw new Error("expected a calculated result");
    }
  });
});

describe("calculatePortCall — refuses rather than guessing", () => {
  it("refuses when the window-ending event is missing", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(portAlex, termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    const r = await calculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (r.ok && r.data.status === "refused") {
      expect(r.data.code).toBe("WINDOW_END_EVENT_MISSING");
    } else {
      throw new Error("expected a refusal");
    }
  });

  it("refuses when the port call has no resolved term", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(portAlex, null);
    const r = await calculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (r.ok && r.data.status === "refused") {
      expect(r.data.code).toBe("PORT_CALL_TERM_UNRESOLVED");
    } else {
      throw new Error("expected a refusal");
    }
  });

  it("refuses an unrecognised allowance unit", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(portAlex, termBadUnit);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");
    const r = await calculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (r.ok && r.data.status === "refused") {
      expect(r.data.code).toBe("ALLOWANCE_UNIT_UNRECOGNISED");
    } else {
      throw new Error("expected a refusal");
    }
  });

  it("refuses a stopped interval whose reason has no rule", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(portAlex, termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");
    await db.insert(stoppages).values({
      organizationId: orgA, portCallId: pc, reasonId: reasonUnruled,
      startTime: D("2026-06-14T02:00:00Z"), endTime: D("2026-06-14T05:00:00Z"),
      recordedByUserId: adminUserId,
    });
    const r = await calculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (r.ok && r.data.status === "refused") {
      expect(r.data.code).toBe("STOPPAGE_RULE_MISSING");
    } else {
      throw new Error("expected a refusal");
    }
  });
});

describe("calculatePortCall — authorization and tenancy", () => {
  it("a viewer cannot recalculate", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(portAlex, termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");

    currentToken = viewerToken;
    const r = await calculatePortCall(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });

  it("another org cannot calculate this port call", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(portAlex, termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");

    currentToken = orgBToken;
    const r = await calculatePortCall(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});
