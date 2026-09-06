"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { users, memberships, organizations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  destroySession,
  getTenantContext,
  requireTenantContext,
  SESSION_COOKIE,
} from "@/lib/auth/session";

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Enter your email and password." };
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));

  // Uniform failure message and a hash comparison even when the user
  // doesn't exist, so response timing doesn't reveal whether an account
  // is registered.
  const dummyHash =
    "scrypt$00000000000000000000000000000000$" + "0".repeat(128);
  const valid = user
    ? await verifyPassword(password, user.passwordHash)
    : (await verifyPassword(password, dummyHash), false);

  if (!user || !valid) {
    return { ok: false, error: "Email or password is incorrect." };
  }

  const orgs = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, user.id));

  if (orgs.length === 0) {
    return {
      ok: false,
      error: "This account has no company access. Contact your administrator.",
    };
  }

  const token = await createSession(user.id, orgs[0].organizationId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return { ok: true };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

/** Organizations the current user may switch into. */
export async function listMyOrganizations() {
  const ctx = await requireTenantContext();
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, ctx.userId));
}

/**
 * Switches the active organization. Verifies membership server-side —
 * the requested organizationId is treated as an untrusted request, not
 * as authority.
 */
export async function switchOrganization(organizationId: string) {
  const ctx = await requireTenantContext();

  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, ctx.userId),
        eq(memberships.organizationId, organizationId)
      )
    );

  if (!membership) {
    return { ok: false as const, error: "You do not have access to that company." };
  }

  const store = await cookies();
  const oldToken = store.get(SESSION_COOKIE)?.value;
  if (oldToken) await destroySession(oldToken);

  const token = await createSession(ctx.userId, organizationId);
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return { ok: true as const };
}

export async function currentContext() {
  return getTenantContext();
}
