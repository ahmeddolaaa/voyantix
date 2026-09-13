import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Same auth approach as event-types.test.ts: replace requireTenantContext
// (the function authorized() calls) with one that resolves a real session
// token through the REAL resolveTenantContext, so every other auth layer
// runs as in production. currentToken selects "who is signed in".
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
import { organizations, users, memberships, laytimeRuleSets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listLaytimeRuleSets,
  createLaytimeRuleSet,
  updateLaytimeRuleSet,
} from "../laytime-rule-sets";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string; // admin in org A
let viewerToken: string; // viewer in org A (masterdata.read only)
let orgBToken: string; // admin in org B

let ruleSetA: string; // an ordinary rule set in org A

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

beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "RS Test A", slug: `rs-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "RS Test B", slug: `rs-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@a.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@a.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@b.test`, orgB, "admin");

  const [rs] = await db
    .insert(laytimeRuleSets)
    .values({
      organizationId: orgA,
      name: `Base SHINC ${stamp}`,
      description: "seed",
    })
    .returning({ id: laytimeRuleSets.id });
  ruleSetA = rs.id;
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("listLaytimeRuleSets", () => {
  it("1. is tenant-scoped: org A sees its own rule sets, org B does not", async () => {
    currentToken = adminToken;
    const a = await listLaytimeRuleSets();
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.data.map((r) => r.id)).toContain(ruleSetA);

    currentToken = orgBToken;
    const b = await listLaytimeRuleSets();
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.data.map((r) => r.id)).not.toContain(ruleSetA);
  });
});

describe("createLaytimeRuleSet", () => {
  it("2. create succeeds for an authorized user", async () => {
    currentToken = adminToken;
    const r = await createLaytimeRuleSet({
      name: `Friday EIU ${stamp}`,
      description: "Friday excepted, EIU applies",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select({ orgId: laytimeRuleSets.organizationId })
      .from(laytimeRuleSets)
      .where(eq(laytimeRuleSets.id, r.data.id));
    expect(row.orgId).toBe(orgA);
  });

  it("3. duplicate name (case/space-insensitive) maps to DUPLICATE_NAME", async () => {
    currentToken = adminToken;
    const name = `Dup RS ${stamp}`;
    const first = await createLaytimeRuleSet({ name });
    expect(first.ok).toBe(true);
    const second = await createLaytimeRuleSet({ name: `  ${name.toUpperCase()}  ` });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("DUPLICATE_NAME");
  });
});

describe("updateLaytimeRuleSet", () => {
  it("4. update succeeds on a same-tenant row", async () => {
    currentToken = adminToken;
    const created = await createLaytimeRuleSet({ name: `Edit RS ${stamp}` });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateLaytimeRuleSet(created.data.id, {
      name: `Edited RS ${stamp}`,
      description: "changed",
    });
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({
        name: laytimeRuleSets.name,
        description: laytimeRuleSets.description,
      })
      .from(laytimeRuleSets)
      .where(eq(laytimeRuleSets.id, created.data.id));
    expect(row.name).toBe(`Edited RS ${stamp}`);
    expect(row.description).toBe("changed");
  });

  it("5. cross-tenant update returns NOT_FOUND", async () => {
    currentToken = orgBToken; // admin of org B targeting org A's row
    const r = await updateLaytimeRuleSet(ruleSetA, {
      name: "Cross Tenant",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");

    // org A's row is untouched.
    const [row] = await db
      .select({ name: laytimeRuleSets.name })
      .from(laytimeRuleSets)
      .where(eq(laytimeRuleSets.id, ruleSetA));
    expect(row.name).toBe(`Base SHINC ${stamp}`);
  });
});

describe("authorization", () => {
  it("6. a user without masterdata.write is rejected with FORBIDDEN", async () => {
    currentToken = viewerToken;
    const r = await createLaytimeRuleSet({ name: `Denied ${stamp}` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});

describe("no setStatus action exists", () => {
  it("7. the module exposes only list/create/update — no status action", async () => {
    const mod = await import("../laytime-rule-sets");
    expect(typeof mod.listLaytimeRuleSets).toBe("function");
    expect(typeof mod.createLaytimeRuleSet).toBe("function");
    expect(typeof mod.updateLaytimeRuleSet).toBe("function");
    // No status/lifecycle action on the RuleSet header (roadmap PO6).
    expect((mod as Record<string, unknown>).setLaytimeRuleSetStatus).toBeUndefined();
  });
});