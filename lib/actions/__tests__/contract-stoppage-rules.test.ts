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
  contracts,
  laytimeRuleSets,
  laytimeRuleSetVersions,
  contractLaytimeTerms,
  stoppageReasons,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listStoppageRules,
  setStoppageRule,
  deleteStoppageRule,
} from "../contract-stoppage-rules";

const stamp = Date.now();

let orgA: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;
let termA: string;
let reasonRain: string;
let reasonShift: string;
let reasonOrgB: string;

async function makeUserWithSession(
  email: string,
  organizationId: string,
  role: "admin" | "viewer"
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("x"), name: email })
    .returning();
  await db.insert(memberships).values({ userId: u.id, organizationId, role });
  return createSession(u.id, organizationId);
}

beforeAll(async () => {
  const [a] = await db.insert(organizations).values({ name: "CSR A", slug: `csr-a-${stamp}` }).returning();
  const [b] = await db.insert(organizations).values({ name: "CSR B", slug: `csr-b-${stamp}` }).returning();
  orgA = a.id;

  adminToken = await makeUserWithSession(`csr-admin-${stamp}@x`, orgA, "admin");
  viewerToken = await makeUserWithSession(`csr-viewer-${stamp}@x`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`csr-b-${stamp}@x`, b.id, "admin");

  const [c] = await db.insert(contracts).values({
    organizationId: orgA, reference: `C-${stamp}`, counterparty: "Acme",
  }).returning();
  const [rs] = await db.insert(laytimeRuleSets).values({
    organizationId: orgA, name: `RS-${stamp}`,
  }).returning();
  const [ver] = await db.insert(laytimeRuleSetVersions).values({
    organizationId: orgA, ruleSetId: rs.id, versionNumber: 1,
  }).returning();
  const [term] = await db.insert(contractLaytimeTerms).values({
    organizationId: orgA, contractId: c.id, function: "LOAD",
    allowance: "5", allowanceUnit: "days", demurrageRate: "1000",
    commencementRule: "NOR_ACCEPTED", ruleSetVersionId: ver.id,
  }).returning();
  termA = term.id;

  const [rr] = await db.insert(stoppageReasons).values({ organizationId: orgA, name: `Rain-${stamp}` }).returning();
  const [rsft] = await db.insert(stoppageReasons).values({ organizationId: orgA, name: `Shift-${stamp}` }).returning();
  const [rb] = await db.insert(stoppageReasons).values({ organizationId: b.id, name: `OrgB-${stamp}` }).returning();
  reasonRain = rr.id;
  reasonShift = rsft.id;
  reasonOrgB = rb.id;
});

describe("setStoppageRule + listStoppageRules", () => {
  it("creates a rule and lists it", async () => {
    currentToken = adminToken;
    const set = await setStoppageRule(termA, { stoppageReasonId: reasonRain, countability: "AlwaysExcluded" });
    expect(set.ok).toBe(true);
    const list = await listStoppageRules(termA);
    expect(list.ok).toBe(true);
    if (list.ok) {
      const r = list.data.find((x) => x.stoppageReasonId === reasonRain);
      expect(r?.countability).toBe("AlwaysExcluded");
    }
  });

  it("upserts: setting the same pair again updates, not duplicates", async () => {
    currentToken = adminToken;
    await setStoppageRule(termA, { stoppageReasonId: reasonShift, countability: "NeverExcluded" });
    await setStoppageRule(termA, { stoppageReasonId: reasonShift, countability: "CountsAgainstOwner" });
    const list = await listStoppageRules(termA);
    if (list.ok) {
      const rows = list.data.filter((x) => x.stoppageReasonId === reasonShift);
      expect(rows.length).toBe(1);
      expect(rows[0].countability).toBe("CountsAgainstOwner");
    }
  });

  it("rejects an invalid countability", async () => {
    currentToken = adminToken;
    // @ts-expect-error deliberately invalid
    const r = await setStoppageRule(termA, { stoppageReasonId: reasonRain, countability: "Maybe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });
});

describe("tenant isolation and authorization", () => {
  it("a viewer cannot set a rule", async () => {
    currentToken = viewerToken;
    const r = await setStoppageRule(termA, { stoppageReasonId: reasonRain, countability: "NeverExcluded" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });

  it("another org cannot see or touch the term", async () => {
    currentToken = orgBToken;
    const list = await listStoppageRules(termA);
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.code).toBe("NOT_FOUND");
  });

  it("a reason from another org is refused (NOT_FOUND, no cross-tenant leak)", async () => {
    currentToken = adminToken;
    const r = await setStoppageRule(termA, { stoppageReasonId: reasonOrgB, countability: "AlwaysExcluded" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("deleteStoppageRule", () => {
  it("deletes a rule", async () => {
    currentToken = adminToken;
    const set = await setStoppageRule(termA, { stoppageReasonId: reasonRain, countability: "AlwaysExcluded" });
    if (set.ok) {
      const del = await deleteStoppageRule(set.data.id);
      expect(del.ok).toBe(true);
    }
  });
});
