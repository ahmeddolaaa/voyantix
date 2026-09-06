import type { Role } from "@/db/schema/platform";
import { ForbiddenError, type TenantContext } from "./session";

/**
 * Named capabilities. Server-side authorization checks reference these,
 * never role names directly — so widening a role later is a one-line
 * change here rather than a hunt through call sites.
 */
export const PERMISSIONS = [
  "voyage.read",
  "voyage.write",
  "operations.write", // events, stoppages, shift performance
  "contract.read",
  "contract.write",
  "statement.read",
  "statement.recalculate",
  "statement.finalize",
  "masterdata.read",
  "masterdata.write",
  "admin.users",
  "admin.configuration",
  "report.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,

  commercial: [
    "voyage.read",
    "voyage.write",
    "operations.write",
    "contract.read",
    "contract.write",
    "statement.read",
    "statement.recalculate",
    "statement.finalize",
    "masterdata.read",
    "report.read",
  ],

  operations: [
    "voyage.read",
    "voyage.write",
    "operations.write",
    "contract.read",
    "statement.read",
    "statement.recalculate",
    "masterdata.read",
    "report.read",
  ],

  viewer: [
    "voyage.read",
    "contract.read",
    "statement.read",
    "masterdata.read",
    "report.read",
  ],
};

export function hasPermission(
  ctx: TenantContext,
  permission: Permission
): boolean {
  return ROLE_PERMISSIONS[ctx.role].includes(permission);
}

/** Throws ForbiddenError if the context lacks the permission. */
export function requirePermission(
  ctx: TenantContext,
  permission: Permission
): void {
  if (!hasPermission(ctx, permission)) {
    throw new ForbiddenError(permission);
  }
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
