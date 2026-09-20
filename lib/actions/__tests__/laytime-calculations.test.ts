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
  laytimeCalculations,
  laytimeIntervals,
  laytimeIntervalStoppageLinks,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  recalculatePortCall,
  getPortCallCalculation,
} from "../laytime-calculations";

const stamp = Date.now();
const D = (iso: string) => new Date(iso);

let orgA: string;
let adminUserId: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;
let voyageA: string;
let termDays: string;
let reasonRuled: string;
let typeNorAccepted: string;
let typeOpsCompleted: string;
let portAlex: string;
let seq = 0;

async function makeUser(email: string, org: string, role: "admin" | "viewer") {
  const [u] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("x"), name: email })
    .returning();
  await db.insert(memberships).values({ userId: u.id, organizationId: org, role });
  return { id: u.id, token: await createSession(u.id, org) };
}

async function makePortCall(termId: string | null): Promise<string> {
  seq += 1;
  const [pc] = await db
    .insert(voyagePortCalls)
    .values({
      organizationId: orgA, voyageId: voyageA, portId: portAlex,
      function: "LOAD", sequence: seq, effectiveTimezone: "Africa/Cairo",
      contractLaytimeTermId: termId,
    })
    .returning({ id: voyagePortCalls.id });
  return pc.id;
}

async function addEvent(portCallId: string, typeId: string, iso: string) {
  await db.insert(operationalEvents).values({
    organizationId: orgA, portCallId, eventTypeId: typeId,
    occurredAt: D(iso), recordedByUserId: adminUserId,
  });
}

beforeAll(async () => {
  const [a] = await db.insert(organizations).values({ name: "LC A", slug: `lc-a-${stamp}` }).returning();
  const [b] = await db.insert(organizations).values({ name: "LC B", slug: `lc-b-${stamp}` }).returning();
  orgA = a.id;

  const admin = await makeUser(`lc-admin-${stamp}@x`, orgA, "admin");
  adminUserId = admin.id;
  adminToken = admin.token;
  viewerToken = (await makeUser(`lc-viewer-${stamp}@x`, orgA, "viewer")).token;
  orgBToken = (await makeUser(`lc-b-${stamp}@x`, b.id, "admin")).token;

  const [p] = await db.insert(ports).values({
    organizationId: orgA, name: `Alex ${stamp}`, country: "EG", defaultTimezone: "Africa/Cairo",
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
    ruleSetVersionId: ver.id,
  }).returning({ id: contractLaytimeTerms.id });
  termDays = term.id;

  const [rr] = await db.insert(stoppageReasons).values({ organizationId: orgA, name: `Rain-${stamp}` }).returning({ id: stoppageReasons.id });
  reasonRuled = rr.id;
  await db.insert(contractStoppageRules).values({
    organizationId: orgA, termId: termDays, stoppageReasonId: reasonRuled, countability: "AlwaysExcluded",
  });

  const [v] = await db.insert(voyages).values({
    organizationId: orgA, voyageReference: `V-${stamp}`, vesselName: "Test Vessel",
  }).returning({ id: voyages.id });
  voyageA = v.id;
});

describe("recalculatePortCall — persists the calculation and time sheet", () => {
  it("stores a calculated result and reads it back", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");

    const r = await recalculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.status).toBe("calculated");
    expect(r.data.persisted).toBe(true);
    expect(r.data.usedSeconds).toBe(2 * 86400);
    expect(r.data.outcome).toBe("SAVED");
    expect(r.data.intervalCount).toBeGreaterThan(0);

    const read = await getPortCallCalculation(pc);
    expect(read.ok).toBe(true);
    if (read.ok && read.data) {
      expect(read.data.status).toBe("calculated");
      expect(read.data.usedSeconds).toBe(2 * 86400);
      expect(read.data.allowedSeconds).toBe(10 * 86400);
      expect(read.data.intervals.length).toBe(r.data.intervalCount);
      // The time sheet is contiguous across the window.
      const sorted = [...read.data.intervals].sort((a, b) => a.sequence - b.sequence);
      expect(sorted[0].start.toISOString()).toBe("2026-06-13T05:00:00.000Z");
      expect(sorted[sorted.length - 1].end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    } else {
      throw new Error("expected a persisted calculation");
    }
  });

  it("recalculation replaces the prior calculation (one per port call)", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");

    const first = await recalculatePortCall(pc);
    const second = await recalculatePortCall(pc);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.data.calculationId).not.toBe(second.data.calculationId);
    }

    const calcs = await db
      .select({ id: laytimeCalculations.id })
      .from(laytimeCalculations)
      .where(
        and(
          eq(laytimeCalculations.portCallId, pc),
          eq(laytimeCalculations.organizationId, orgA)
        )
      );
    expect(calcs.length).toBe(1);
  });
});

describe("recalculatePortCall — stoppage traceability", () => {
  it("links an excluded interval to the stoppage that caused it", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");
    const [stop] = await db.insert(stoppages).values({
      organizationId: orgA, portCallId: pc, reasonId: reasonRuled,
      startTime: D("2026-06-14T02:00:00Z"), endTime: D("2026-06-14T05:00:00Z"),
      recordedByUserId: adminUserId,
    }).returning({ id: stoppages.id });

    const r = await recalculatePortCall(pc);
    expect(r.ok && r.data.status === "calculated").toBe(true);
    if (r.ok && r.data.status === "calculated") {
      expect(r.data.usedSeconds).toBe(2 * 86400 - 3 * 3600);
    }

    const links = await db
      .select({ stoppageId: laytimeIntervalStoppageLinks.stoppageId })
      .from(laytimeIntervalStoppageLinks)
      .where(eq(laytimeIntervalStoppageLinks.organizationId, orgA));
    expect(links.some((l) => l.stoppageId === stop.id)).toBe(true);
  });
});

describe("recalculatePortCall — refusals", () => {
  it("persists a refusal with no intervals", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");

    const r = await recalculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.status).toBe("refused");
      expect(r.data.refusalCode).toBe("WINDOW_END_EVENT_MISSING");
      expect(r.data.persisted).toBe(true);
      expect(r.data.intervalCount).toBe(0);
    }

    const read = await getPortCallCalculation(pc);
    if (read.ok && read.data) {
      expect(read.data.status).toBe("refused");
      expect(read.data.intervals.length).toBe(0);
      expect(read.data.window).toBeNull();
    } else {
      throw new Error("expected a persisted refusal");
    }
  });

  it("returns an unpersisted refusal when the port call has no term", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(null);
    const r = await recalculatePortCall(pc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.status).toBe("refused");
      expect(r.data.refusalCode).toBe("PORT_CALL_TERM_UNRESOLVED");
      expect(r.data.persisted).toBe(false);
    }
    const read = await getPortCallCalculation(pc);
    expect(read.ok && read.data === null).toBe(true);
  });
});

describe("recalculatePortCall — authorization and tenancy", () => {
  it("a viewer cannot recalculate", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");
    currentToken = viewerToken;
    const r = await recalculatePortCall(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });

  it("another org cannot recalculate this port call", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(termDays);
    currentToken = orgBToken;
    const r = await recalculatePortCall(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("a viewer CAN read a persisted calculation", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(termDays);
    await addEvent(pc, typeNorAccepted, "2026-06-12T05:00:00Z");
    await addEvent(pc, typeOpsCompleted, "2026-06-15T05:00:00Z");
    await recalculatePortCall(pc);
    currentToken = viewerToken;
    const read = await getPortCallCalculation(pc);
    expect(read.ok).toBe(true);
    if (read.ok && read.data) expect(read.data.status).toBe("calculated");
  });
});
