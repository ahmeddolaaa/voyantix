import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "@/db/client";
import {
  organizations,
  users,
  memberships,
  sessions,
  companyConfigurations,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  createSession,
  resolveTenantContext,
  destroySession,
} from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { hasPermission, requirePermission } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/session";

/**
 * TENANT ISOLATION — real data, real code path.
 *
 * Two actual organizations with actual users and actual sessions.
 * These tests exercise `resolveTenantContext`, which is the function
 * every server action depends on, rather than asserting against
 * fabricated ids that would never have matched anything anyway.
 */

let orgA: string;
let orgB: string;
let userA: string;
let userB: string;
let userBoth: string;
let sessionA: string;
let sessionB: string;

beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "Alpha Shipping", slug: `alpha-${Date.now()}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "Beta Chartering", slug: `beta-${Date.now()}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  const hash = await hashPassword("correct-horse-battery");

  const [ua] = await db
    .insert(users)
    .values({
      email: `a-${Date.now()}@alpha.test`,
      passwordHash: hash,
      name: "Alice (Alpha ops)",
    })
    .returning();
  const [ub] = await db
    .insert(users)
    .values({
      email: `b-${Date.now()}@beta.test`,
      passwordHash: hash,
      name: "Bob (Beta admin)",
    })
    .returning();
  const [uc] = await db
    .insert(users)
    .values({
      email: `c-${Date.now()}@both.test`,
      passwordHash: hash,
      name: "Carol (consultant, both orgs)",
    })
    .returning();
  userA = ua.id;
  userB = ub.id;
  userBoth = uc.id;

  await db.insert(memberships).values([
    { userId: userA, organizationId: orgA, role: "operations" },
    { userId: userB, organizationId: orgB, role: "admin" },
    { userId: userBoth, organizationId: orgA, role: "viewer" },
    { userId: userBoth, organizationId: orgB, role: "commercial" },
  ]);

  await db.insert(companyConfigurations).values([
    { organizationId: orgA, defaultTimezone: "Africa/Cairo" },
    { organizationId: orgB, defaultTimezone: "Europe/Istanbul" },
  ]);

  sessionA = await createSession(userA, orgA);
  sessionB = await createSession(userB, orgB);
});

afterAll(async () => {
  await db.delete(sessions).where(inArray(sessions.userId, [userA, userB, userBoth]));
  await db
    .delete(companyConfigurations)
    .where(inArray(companyConfigurations.organizationId, [orgA, orgB]));
  await db.delete(memberships).where(inArray(memberships.userId, [userA, userB, userBoth]));
  await db.delete(users).where(inArray(users.id, [userA, userB, userBoth]));
  await db.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
  await pool.end();
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("s3cret-passphrase", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces a different hash each time (salted)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("rejects a malformed stored hash rather than throwing", async () => {
    expect(await verifyPassword("x", "not-a-real-hash")).toBe(false);
  });
});

describe("tenant context resolution", () => {
  it("resolves org A for user A's session", async () => {
    const ctx = await resolveTenantContext(sessionA);
    expect(ctx).not.toBeNull();
    expect(ctx!.organizationId).toBe(orgA);
    expect(ctx!.organizationName).toBe("Alpha Shipping");
    expect(ctx!.role).toBe("operations");
  });

  it("resolves org B for user B's session — a DIFFERENT tenant", async () => {
    const ctx = await resolveTenantContext(sessionB);
    expect(ctx!.organizationId).toBe(orgB);
    expect(ctx!.role).toBe("admin");
    // The decisive assertion: two live sessions resolve to two different
    // tenants through the same code path.
    expect(ctx!.organizationId).not.toBe(orgA);
  });

  it("returns null for an unknown token", async () => {
    expect(await resolveTenantContext("not-a-real-token")).toBeNull();
  });

  it("returns null when no token is supplied", async () => {
    expect(await resolveTenantContext(undefined)).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const token = await createSession(userA, orgA);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, token));
    expect(await resolveTenantContext(token)).toBeNull();
    await destroySession(token);
  });

  it("returns null after the session is destroyed (logout)", async () => {
    const token = await createSession(userA, orgA);
    expect(await resolveTenantContext(token)).not.toBeNull();
    await destroySession(token);
    expect(await resolveTenantContext(token)).toBeNull();
  });
});

describe("cross-tenant access is impossible through the session path", () => {
  it("a session cannot be pointed at another org by forging the cookie value", async () => {
    // The only thing a browser controls is the token string. It carries
    // no organization information, so there is nothing to tamper with:
    // supplying org B's id as a token resolves to nothing.
    expect(await resolveTenantContext(orgB)).toBeNull();
  });

  it("revoking membership invalidates an existing session immediately", async () => {
    const token = await createSession(userBoth, orgA);
    expect((await resolveTenantContext(token))!.organizationId).toBe(orgA);

    // Admin removes Carol from Alpha while her session is still live.
    await db
      .delete(memberships)
      .where(eq(memberships.userId, userBoth) && eq(memberships.organizationId, orgA));
    await db
      .delete(memberships)
      .where(eq(memberships.organizationId, orgA));

    expect(await resolveTenantContext(token)).toBeNull();

    // restore for other tests / cleanup symmetry
    await db
      .insert(memberships)
      .values({ userId: userA, organizationId: orgA, role: "operations" });
    await db
      .insert(memberships)
      .values({ userId: userBoth, organizationId: orgA, role: "viewer" });
    await destroySession(token);
  });

  it("a user in two orgs gets the role of the ACTIVE org only", async () => {
    const tokenAlpha = await createSession(userBoth, orgA);
    const tokenBeta = await createSession(userBoth, orgB);

    const ctxAlpha = await resolveTenantContext(tokenAlpha);
    const ctxBeta = await resolveTenantContext(tokenBeta);

    expect(ctxAlpha!.role).toBe("viewer");
    expect(ctxBeta!.role).toBe("commercial");
    expect(ctxAlpha!.organizationId).not.toBe(ctxBeta!.organizationId);

    // And the permission consequences differ accordingly.
    expect(hasPermission(ctxAlpha!, "voyage.write")).toBe(false);
    expect(hasPermission(ctxBeta!, "voyage.write")).toBe(true);

    await destroySession(tokenAlpha);
    await destroySession(tokenBeta);
  });
});

describe("authorization", () => {
  it("operations role cannot finalize a statement", async () => {
    const ctx = await resolveTenantContext(sessionA);
    expect(hasPermission(ctx!, "statement.recalculate")).toBe(true);
    expect(hasPermission(ctx!, "statement.finalize")).toBe(false);
    expect(() => requirePermission(ctx!, "statement.finalize")).toThrow(
      ForbiddenError
    );
  });

  it("operations role cannot administer users", async () => {
    const ctx = await resolveTenantContext(sessionA);
    expect(hasPermission(ctx!, "admin.users")).toBe(false);
  });

  it("admin role has every permission", async () => {
    const ctx = await resolveTenantContext(sessionB);
    expect(hasPermission(ctx!, "admin.users")).toBe(true);
    expect(hasPermission(ctx!, "statement.finalize")).toBe(true);
    expect(hasPermission(ctx!, "masterdata.write")).toBe(true);
  });

  it("viewer cannot write anything", async () => {
    const token = await createSession(userBoth, orgA); // viewer in Alpha
    const ctx = await resolveTenantContext(token);
    expect(hasPermission(ctx!, "voyage.write")).toBe(false);
    expect(hasPermission(ctx!, "operations.write")).toBe(false);
    expect(hasPermission(ctx!, "masterdata.write")).toBe(false);
    expect(hasPermission(ctx!, "voyage.read")).toBe(true);
    await destroySession(token);
  });
});
