import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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
  laytimeRuleSets,
  laytimeRuleSetVersions,
  contracts,
  contractLaytimeTerms,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listRuleSetVersions,
  createRuleSetVersion,
  updateRuleSetVersion,
} from "../laytime-rule-set-versions";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let ruleSetA: string; // rule set in org A
let ruleSetB: string; // rule set in org B (for cross-tenant checks)

async function makeUserWithSession(
  email: string,
  organizationId: string,
  role: "admin" | "viewer"
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword("correct-horse-battery"),
      name: email,
    })
    .returning();
  await db.insert(memberships).values({ userId: u.id, organizationId, role });
  return createSession(u.id, organizationId);
}

async function makeRuleSet(orgId: string, name: string): Promise<string> {
  const [rs] = await db
    .insert(laytimeRuleSets)
    .values({ organizationId: orgId, name })
    .returning({ id: laytimeRuleSets.id });
  return rs.id;
}

/** Creates a contract + a term that references the given version, so the
 *  version becomes "referenced" (immutable). Returns nothing. */
async function referenceVersion(
  orgId: string,
  versionId: string
): Promise<void> {
  const [c] = await db
    .insert(contracts)
    .values({
      organizationId: orgId,
      reference: `C-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      counterparty: "Acme",
    })
    .returning({ id: contracts.id });

  await db.insert(contractLaytimeTerms).values({
    organizationId: orgId,
    contractId: c.id,
    function: "LOAD",
    allowance: "10",
    allowanceUnit: "days",
    demurrageRate: "5000",
    commencementRule: "on_nor_accepted",
    ruleSetVersionId: versionId,
  });
}

beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "RSV Test A", slug: `rsv-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "RSV Test B", slug: `rsv-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@a.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@a.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@b.test`, orgB, "admin");

  ruleSetA = await makeRuleSet(orgA, `RS A ${stamp}`);
  ruleSetB = await makeRuleSet(orgB, `RS B ${stamp}`);
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("createRuleSetVersion", () => {
  it("1. assigns sequential version numbers within a rule set", async () => {
    currentToken = adminToken;
    const v1 = await createRuleSetVersion(ruleSetA, { excludeHolidays: true });
    const v2 = await createRuleSetVersion(ruleSetA, { eiuApplies: true });
    expect(v1.ok && v2.ok).toBe(true);
    if (v1.ok && v2.ok) {
      expect(v2.data.versionNumber).toBe(v1.data.versionNumber + 1);
    }
  });

  it("2. normalizes excludedWeekdays (unique, sorted) and validates range", async () => {
    currentToken = adminToken;
    const ok = await createRuleSetVersion(ruleSetA, {
      excludedWeekdays: [6, 5, 5],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const [row] = await db
        .select({ wd: laytimeRuleSetVersions.excludedWeekdays })
        .from(laytimeRuleSetVersions)
        .where(eq(laytimeRuleSetVersions.id, ok.data.id));
      expect(row.wd).toEqual([5, 6]);
    }

    const bad = await createRuleSetVersion(ruleSetA, { excludedWeekdays: [7] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("VALIDATION_ERROR");
  });

  it("3. rejects a half-open working day window", async () => {
    currentToken = adminToken;
    const r = await createRuleSetVersion(ruleSetA, {
      workingDayStart: "08:00",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("4. create on another org's rule set returns NOT_FOUND", async () => {
    currentToken = adminToken; // org A user targeting org B's rule set
    const r = await createRuleSetVersion(ruleSetB, { eiuApplies: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("listRuleSetVersions", () => {
  it("5. lists a rule set's versions, newest first, tenant-scoped", async () => {
    currentToken = adminToken;
    const r = await listRuleSetVersions(ruleSetA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const nums = r.data.map((x) => x.versionNumber);
      const sorted = [...nums].sort((a, b) => b - a);
      expect(nums).toEqual(sorted);
    }

    // Cross-tenant: org B user cannot list org A's rule set.
    currentToken = orgBToken;
    const cross = await listRuleSetVersions(ruleSetA);
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.code).toBe("NOT_FOUND");
  });
});

describe("updateRuleSetVersion — model B immutability", () => {
  it("6. an UNREFERENCED version is edited in place (same number, created:false)", async () => {
    currentToken = adminToken;
    const created = await createRuleSetVersion(ruleSetA, { eiuApplies: false });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const upd = await updateRuleSetVersion(created.data.id, {
      eiuApplies: true,
    });
    expect(upd.ok).toBe(true);
    if (upd.ok) {
      expect(upd.data.created).toBe(false);
      expect(upd.data.id).toBe(created.data.id);
      expect(upd.data.versionNumber).toBe(created.data.versionNumber);
    }

    const [row] = await db
      .select({ eiu: laytimeRuleSetVersions.eiuApplies })
      .from(laytimeRuleSetVersions)
      .where(eq(laytimeRuleSetVersions.id, created.data.id));
    expect(row.eiu).toBe(true);
  });

  it("7. a REFERENCED version is frozen: update creates a NEW version and leaves the old one untouched", async () => {
    currentToken = adminToken;
    const created = await createRuleSetVersion(ruleSetA, { eiuApplies: false });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Make it referenced by a term.
    await referenceVersion(orgA, created.data.id);

    const upd = await updateRuleSetVersion(created.data.id, {
      eiuApplies: true,
    });
    expect(upd.ok).toBe(true);
    if (upd.ok) {
      expect(upd.data.created).toBe(true);
      expect(upd.data.id).not.toBe(created.data.id);
      expect(upd.data.versionNumber).toBeGreaterThan(created.data.versionNumber);
    }

    // The old (referenced) version is unchanged.
    const [oldRow] = await db
      .select({ eiu: laytimeRuleSetVersions.eiuApplies })
      .from(laytimeRuleSetVersions)
      .where(eq(laytimeRuleSetVersions.id, created.data.id));
    expect(oldRow.eiu).toBe(false);

    // The term still points at the OLD version (historical reproducibility).
    if (upd.ok) {
      const stillOld = await db
        .select({ id: contractLaytimeTerms.id })
        .from(contractLaytimeTerms)
        .where(
          and(
            eq(contractLaytimeTerms.ruleSetVersionId, created.data.id),
            eq(contractLaytimeTerms.organizationId, orgA)
          )
        );
      expect(stillOld.length).toBeGreaterThan(0);
    }
  });
});

describe("authorization", () => {
  it("8. a user without masterdata.write is rejected with FORBIDDEN", async () => {
    currentToken = viewerToken;
        const r = await createRuleSetVersion(ruleSetA, { eiuApplies: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});