import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "@/db/client";
import {
  organizations,
  users,
  memberships,
  sessions,
  companyConfigurations,
} from "@/db/schema";
import { inArray } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession, resolveTenantContext } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/session";

/**
 * Simulates what `authorized()` does on every request, without needing
 * Next's cookie context: resolve a real session, then enforce a real
 * permission. This is the exact path every server action takes.
 */
async function simulateAuthorizedCall(
  token: string,
  permission: Parameters<typeof requirePermission>[1]
) {
  const ctx = await resolveTenantContext(token);
  if (!ctx) throw new Error("Not authenticated");
  requirePermission(ctx, permission);
  return ctx;
}

let orgId: string;
let adminId: string;
let opsId: string;
let viewerId: string;
let adminToken: string;
let opsToken: string;
let viewerToken: string;

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: "Runtime Test Co", slug: `runtime-${Date.now()}` })
    .returning();
  orgId = org.id;

  await db.insert(companyConfigurations).values({ organizationId: orgId });

  const hash = await hashPassword("pw");
  const stamp = Date.now();

  const inserted = await db
    .insert(users)
    .values([
      { email: `adm-${stamp}@t.test`, passwordHash: hash, name: "Admin User" },
      { email: `ops-${stamp}@t.test`, passwordHash: hash, name: "Ops User" },
      { email: `vw-${stamp}@t.test`, passwordHash: hash, name: "Viewer User" },
    ])
    .returning();
  [adminId, opsId, viewerId] = inserted.map((u) => u.id);

  await db.insert(memberships).values([
    { userId: adminId, organizationId: orgId, role: "admin" },
    { userId: opsId, organizationId: orgId, role: "operations" },
    { userId: viewerId, organizationId: orgId, role: "viewer" },
  ]);

  adminToken = await createSession(adminId, orgId);
  opsToken = await createSession(opsId, orgId);
  viewerToken = await createSession(viewerId, orgId);
});

afterAll(async () => {
  const ids = [adminId, opsId, viewerId];
  await db.delete(sessions).where(inArray(sessions.userId, ids));
  await db.delete(memberships).where(inArray(memberships.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  await db
    .delete(companyConfigurations)
    .where(inArray(companyConfigurations.organizationId, [orgId]));
  await db.delete(organizations).where(inArray(organizations.id, [orgId]));
  await pool.end();
});

describe("authorized() enforcement — the path every server action uses", () => {
  it("admin may finalize a statement", async () => {
    const ctx = await simulateAuthorizedCall(adminToken, "statement.finalize");
    expect(ctx.role).toBe("admin");
  });

  it("operations may recalculate but NOT finalize", async () => {
    await expect(
      simulateAuthorizedCall(opsToken, "statement.recalculate")
    ).resolves.toBeTruthy();

    await expect(
      simulateAuthorizedCall(opsToken, "statement.finalize")
    ).rejects.toThrow(ForbiddenError);
  });

  it("viewer may read but NOT write voyages", async () => {
    await expect(
      simulateAuthorizedCall(viewerToken, "voyage.read")
    ).resolves.toBeTruthy();

    await expect(
      simulateAuthorizedCall(viewerToken, "voyage.write")
    ).rejects.toThrow(ForbiddenError);
  });

  it("viewer may NOT administer", async () => {
    await expect(
      simulateAuthorizedCall(viewerToken, "admin.users")
    ).rejects.toThrow(ForbiddenError);
  });

  it("an invalid token is rejected before any permission check", async () => {
    await expect(
      simulateAuthorizedCall("garbage-token", "voyage.read")
    ).rejects.toThrow("Not authenticated");
  });

  it("every authorized context carries a server-derived organizationId", async () => {
    for (const token of [adminToken, opsToken, viewerToken]) {
      const ctx = await simulateAuthorizedCall(token, "voyage.read");
      expect(ctx.organizationId).toBe(orgId);
    }
  });
});

describe("concurrency — session creation under parallel load", () => {
  it("creates distinct session tokens for 20 simultaneous logins", async () => {
    const tokens = await Promise.all(
      Array.from({ length: 20 }, () => createSession(adminId, orgId))
    );
    expect(new Set(tokens).size).toBe(20);

    const contexts = await Promise.all(tokens.map((t) => resolveTenantContext(t)));
    expect(contexts.every((c) => c?.organizationId === orgId)).toBe(true);

    await db.delete(sessions).where(inArray(sessions.id, tokens));
  });
});
