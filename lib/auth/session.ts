import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { sessions, memberships, users, organizations } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import type { Role } from "@/db/schema/platform";

export const SESSION_COOKIE = "voyantix_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

/**
 * TenantContext is the ONLY authority for tenant scope in the product.
 *
 * It is derived exclusively from the server-side session record. No
 * organizationId supplied by the browser is ever trusted for
 * authorization (Phase 2 FINAL §N).
 */
export type TenantContext = {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  role: Role;
};

export async function createSession(
  userId: string,
  organizationId: string
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id: token,
    userId,
    activeOrganizationId: organizationId,
    expiresAt,
  });

  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}

/**
 * Resolves the trusted tenant context, or null if unauthenticated.
 *
 * Critically, this re-verifies the membership on every request rather
 * than trusting what was true at login: if an administrator revokes a
 * user's access to an organization, the next request fails even though
 * the session cookie is still valid.
 */
export async function resolveTenantContext(
  token: string | undefined
): Promise<TenantContext | null> {
  if (!token) return null;

  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      organizationId: organizations.id,
      organizationName: organizations.name,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(
      organizations,
      eq(sessions.activeOrganizationId, organizations.id)
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, sessions.userId),
        eq(memberships.organizationId, sessions.activeOrganizationId)
      )
    )
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));

  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, role: r.role as Role };
}

/** Reads the session cookie and resolves context. Returns null if absent. */
export async function getTenantContext(): Promise<TenantContext | null> {
  const store = await cookies();
  return resolveTenantContext(store.get(SESSION_COOKIE)?.value);
}

/** Throws if unauthenticated. Use in every server action / page needing data. */
export async function requireTenantContext(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) throw new UnauthenticatedError();
  return ctx;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}
