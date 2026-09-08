"use server";

import { db } from "@/db/client";
import { facilities, ports } from "@/db/schema";
import { and, asc, eq, or } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * FACILITY MASTER DATA — terminals, berths, plants and loading points.
 * ---------------------------------------------------------------------------
 * Replaces the old "Factory", which assumed one customer's industry.
 *
 * A facility belongs to a port, and the composite foreign key
 * (port_id, organization_id) means PostgreSQL itself rejects a facility
 * pointing at another organization's port. A cross-tenant portId therefore
 * surfaces as NOT_FOUND rather than as a leak.
 *
 * Lifecycle is active/inactive, as with ports. No hard delete: usage cannot
 * be checked honestly until VoyagePortCall exists in Phase 4.
 * ---------------------------------------------------------------------------
 */

export type FacilityRow = {
  id: string;
  name: string;
  code: string | null;
  type: string | null;
  status: "active" | "inactive";
  portId: string;
  portName: string;
  portStatus: "active" | "inactive";
};

export type PortChoice = {
  id: string;
  name: string;
  status: "active" | "inactive";
};

const facilityColumns = {
  id: facilities.id,
  name: facilities.name,
  code: facilities.code,
  type: facilities.type,
  status: facilities.status,
  portId: facilities.portId,
  portName: ports.name,
  portStatus: ports.status,
};

async function facilityAction<T>(
  permission: Parameters<typeof authorized>[0],
  fn: Parameters<typeof authorized<ActionResult<T>>>[1]
): Promise<ActionResult<T>> {
  try {
    return await authorized<ActionResult<T>>(permission, fn);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<T>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}

function optionalText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type FacilityInput = {
  portId: string;
  name: string;
  code?: string | null;
  type?: string | null;
};

type ValidatedFacility = {
  portId: string;
  name: string;
  code: string | null;
  type: string | null;
};

function validateFacilityInput(
  input: FacilityInput
): ActionResult<ValidatedFacility> {
  const portId = (input.portId ?? "").trim();
  if (portId === "") {
    return fail("VALIDATION_ERROR", "Select the port this facility belongs to.");
  }

  const name = (input.name ?? "").trim();
  if (name === "") {
    return fail("VALIDATION_ERROR", "Facility name is required.");
  }
  if (name.length > 120) {
    return fail("VALIDATION_ERROR", "Facility name must be 120 characters or fewer.");
  }

  const code = optionalText(input.code);
  if (code !== null && code.length > 32) {
    return fail("VALIDATION_ERROR", "Code must be 32 characters or fewer.");
  }

  const type = optionalText(input.type);
  if (type !== null && type.length > 60) {
    return fail("VALIDATION_ERROR", "Type must be 60 characters or fewer.");
  }

  return ok({ portId, name, code, type });
}

export async function listFacilities(
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<FacilityRow[]>> {
  return facilityAction<FacilityRow[]>("masterdata.read", async (ctx) => {
    const scope = options.includeInactive
      ? eq(facilities.organizationId, ctx.organizationId)
      : and(
          eq(facilities.organizationId, ctx.organizationId),
          eq(facilities.status, "active")
        );

    const rows = await db
      .select(facilityColumns)
      .from(facilities)
      .innerJoin(ports, eq(facilities.portId, ports.id))
      .where(scope)
      .orderBy(asc(ports.name), asc(facilities.name));

    return ok(rows as FacilityRow[]);
  });
}

/**
 * Ports offered when creating or editing a facility.
 *
 * Only active ports are offered for a new choice. When editing, the
 * facility's CURRENT port is included even if it has since been
 * deactivated — otherwise renaming a facility would silently force the
 * administrator to move it to a different port.
 */
export async function listPortChoices(
  currentPortId?: string
): Promise<ActionResult<PortChoice[]>> {
  return facilityAction<PortChoice[]>("masterdata.read", async (ctx) => {
    const includeCurrent =
      currentPortId && currentPortId.trim() !== ""
        ? or(eq(ports.status, "active"), eq(ports.id, currentPortId))
        : eq(ports.status, "active");

    const rows = await db
      .select({ id: ports.id, name: ports.name, status: ports.status })
      .from(ports)
      .where(and(eq(ports.organizationId, ctx.organizationId), includeCurrent))
      .orderBy(asc(ports.name));

    return ok(rows as PortChoice[]);
  });
}

export async function createFacility(
  input: FacilityInput
): Promise<ActionResult<{ id: string }>> {
  return facilityAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateFacilityInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(facilities)
        .values({
          organizationId: ctx.organizationId,
          portId: v.portId,
          name: v.name,
          code: v.code,
          type: v.type,
        })
        .returning({ id: facilities.id });

      await recordAudit(ctx, {
        entityType: "Facility",
        entityId: created.id,
        action: "create",
        after: v,
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateFacility(
  id: string,
  input: FacilityInput
): Promise<ActionResult<{ id: string }>> {
  return facilityAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateFacilityInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          portId: facilities.portId,
          name: facilities.name,
          code: facilities.code,
          type: facilities.type,
        })
        .from(facilities)
        .where(
          and(
            eq(facilities.id, id),
            eq(facilities.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Facility not found.");
      }

      const [updated] = await db
        .update(facilities)
        .set({
          portId: v.portId,
          name: v.name,
          code: v.code,
          type: v.type,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(facilities.id, id),
            eq(facilities.organizationId, ctx.organizationId)
          )
        )
        .returning({ id: facilities.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Facility not found.");
      }

      await recordAudit(ctx, {
        entityType: "Facility",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setFacilityStatus(
  id: string,
  status: "active" | "inactive"
): Promise<
  ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>
> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return facilityAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "active" && status !== "inactive") {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: facilities.status })
        .from(facilities)
        .where(
          and(
            eq(facilities.id, id),
            eq(facilities.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Facility not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      await db
        .update(facilities)
        .set({ status, updatedAt: new Date() })
        .where(
          and(
            eq(facilities.id, id),
            eq(facilities.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "Facility",
        entityId: id,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}
