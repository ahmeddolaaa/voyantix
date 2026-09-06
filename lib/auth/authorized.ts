import { requireTenantContext, type TenantContext } from "./session";
import { requirePermission, type Permission } from "./permissions";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";

/**
 * Every business operation goes through here.
 *
 * It guarantees, in one place, that an operation is:
 *   1. authenticated
 *   2. authorized for a named permission
 *   3. handed a TenantContext whose organizationId came from the
 *      server-side session and nowhere else
 *
 * The callback receives the context, so a query that needs tenant
 * scoping has the organizationId immediately to hand and has no reason
 * to reach for a global default. There is no `getDefaultOrganizationId`
 * in this codebase any more, and nothing should reintroduce one.
 */
export async function authorized<T>(
  permission: Permission,
  fn: (ctx: TenantContext) => Promise<T>
): Promise<T> {
  const ctx = await requireTenantContext();
  requirePermission(ctx, permission);
  return fn(ctx);
}

/** Append-only audit write. Never throws into the caller's happy path. */
export async function recordAudit(
  ctx: TenantContext,
  entry: {
    entityType: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
  }
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before ?? null,
      afterJson: entry.after ?? null,
    });
  } catch (e) {
    // Audit must never break a legitimate business operation, but a
    // silent failure would be worse — surface it in logs.
    console.error("[audit] failed to record", entry.action, e);
  }
}
