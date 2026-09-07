"use server";

import { db } from "@/db/client";
import { ports, holidayCalendars } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { resolveTimezone } from "@/lib/master-data/timezone";
import {
  type ActionResult,
  ok,
  fail,
  withDatabaseErrors,
} from "./result";

/**
 * PORT MASTER DATA — server actions
 * ---------------------------------------------------------------------------
 * Every action follows one path:
 *
 *   authorization -> validation -> domain rules -> database
 *                 -> shared error mapping -> audit
 *
 * Tenant scope always comes from the session-derived TenantContext. No
 * organizationId is ever accepted from the caller.
 *
 * LIFECYCLE — active/inactive only. There is deliberately NO hard delete.
 * A port cannot yet be checked for real usage: VoyagePortCall and the
 * operational tables arrive in Phase 4/5, so a delete implemented today
 * would either orphan dependent rows or ship a usage check that is only
 * half true. The final hard-delete policy is to be established once all
 * dependent domain relationships exist. Deactivation covers the real
 * administrative need in the meantime: an inactive port disappears from
 * new operational selection while remaining valid for historical records.
 * ---------------------------------------------------------------------------
 */

export type PortRow = {
  id: string;
  name: string;
  country: string;
  unlocode: string | null;
  defaultTimezone: string;
  status: "active" | "inactive";
  defaultHolidayCalendarId: string | null;
  defaultHolidayCalendarName: string | null;
};

const portColumns = {
  id: ports.id,
  name: ports.name,
  country: ports.country,
  unlocode: ports.unlocode,
  defaultTimezone: ports.defaultTimezone,
  status: ports.status,
  defaultHolidayCalendarId: ports.defaultHolidayCalendarId,
  defaultHolidayCalendarName: holidayCalendars.name,
};

/**
 * Converts a permission failure into a FORBIDDEN result rather than letting
 * it escape as an exception, so the UI can present it consistently with
 * every other outcome. An UnauthenticatedError is deliberately NOT caught:
 * that is a session problem for the layout to handle by redirecting to
 * /login, not a message to render inside an admin screen.
 */
async function portAction<T>(
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

/** Trims, and treats an all-whitespace optional field as absent. */
function optionalText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type PortInput = {
  name: string;
  country: string;
  unlocode?: string | null;
  defaultTimezone: string;
  defaultHolidayCalendarId?: string | null;
};

type ValidatedPort = {
  name: string;
  country: string;
  unlocode: string | null;
  defaultTimezone: string;
  defaultHolidayCalendarId: string | null;
};

/**
 * Server-side validation. The UI performs its own checks for responsiveness,
 * but this is the authoritative pass — an action reached by any other route
 * is validated exactly the same way.
 */
function validatePortInput(
  input: PortInput
): ActionResult<ValidatedPort> {
  const name = (input.name ?? "").trim();
  if (name === "") {
    return fail("VALIDATION_ERROR", "Port name is required.");
  }
  if (name.length > 120) {
    return fail("VALIDATION_ERROR", "Port name must be 120 characters or fewer.");
  }

  const country = (input.country ?? "").trim();
  if (country === "") {
    return fail("VALIDATION_ERROR", "Country is required.");
  }
  if (country.length > 120) {
    return fail("VALIDATION_ERROR", "Country must be 120 characters or fewer.");
  }

  const unlocode = optionalText(input.unlocode);
  if (unlocode !== null && unlocode.length > 16) {
    return fail("VALIDATION_ERROR", "UN/LOCODE must be 16 characters or fewer.");
  }

  // Timezone is stored in its canonical IANA form, never as the raw input
  // and never as a UTC offset. See lib/master-data/timezone.ts.
  const rawTimezone = (input.defaultTimezone ?? "").trim();
  if (rawTimezone === "") {
    return fail("INVALID_TIMEZONE", "A default timezone is required.");
  }
  const defaultTimezone = resolveTimezone(rawTimezone);
  if (defaultTimezone === null) {
    return fail(
      "INVALID_TIMEZONE",
      "Enter a valid IANA timezone, for example Africa/Cairo. Fixed UTC offsets are not accepted because they carry no daylight-saving rule."
    );
  }

  return ok({
    name,
    country,
    unlocode,
    defaultTimezone,
    defaultHolidayCalendarId: optionalText(input.defaultHolidayCalendarId),
  });
}

export async function listPorts(
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<PortRow[]>> {
  return portAction<PortRow[]>("masterdata.read", async (ctx) => {
    const scope = options.includeInactive
      ? eq(ports.organizationId, ctx.organizationId)
      : and(
          eq(ports.organizationId, ctx.organizationId),
          eq(ports.status, "active")
        );

    const rows = await db
      .select(portColumns)
      .from(ports)
      .leftJoin(
        holidayCalendars,
        eq(ports.defaultHolidayCalendarId, holidayCalendars.id)
      )
      .where(scope)
      .orderBy(asc(ports.name));

    return ok(rows as PortRow[]);
  });
}

export async function getPort(id: string): Promise<ActionResult<PortRow>> {
  return portAction<PortRow>("masterdata.read", async (ctx) => {
    const rows = await db
      .select(portColumns)
      .from(ports)
      .leftJoin(
        holidayCalendars,
        eq(ports.defaultHolidayCalendarId, holidayCalendars.id)
      )
      .where(
        and(eq(ports.id, id), eq(ports.organizationId, ctx.organizationId))
      );

    // A port belonging to another organization is reported as NOT_FOUND, not
    // FORBIDDEN — confirming its existence would leak another customer's data.
    if (rows.length === 0) {
      return fail<PortRow>("NOT_FOUND", "Port not found.");
    }
    return ok(rows[0] as PortRow);
  });
}

export async function createPort(
  input: PortInput
): Promise<ActionResult<{ id: string }>> {
  return portAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validatePortInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(ports)
        .values({
          organizationId: ctx.organizationId,
          name: v.name,
          country: v.country,
          unlocode: v.unlocode,
          defaultTimezone: v.defaultTimezone,
          defaultHolidayCalendarId: v.defaultHolidayCalendarId,
        })
        .returning({ id: ports.id });

      await recordAudit(ctx, {
        entityType: "Port",
        entityId: created.id,
        action: "create",
        after: v,
      });

      return ok({ id: created.id });
    });
  });
}

export async function updatePort(
  id: string,
  input: PortInput
): Promise<ActionResult<{ id: string }>> {
  return portAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validatePortInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      // Read the prior state within the tenant scope so the audit trail
      // records what actually changed, and so a cross-tenant id resolves to
      // NOT_FOUND before any write is attempted.
      const existing = await db
        .select({
          name: ports.name,
          country: ports.country,
          unlocode: ports.unlocode,
          defaultTimezone: ports.defaultTimezone,
          defaultHolidayCalendarId: ports.defaultHolidayCalendarId,
        })
        .from(ports)
        .where(
          and(eq(ports.id, id), eq(ports.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Port not found.");
      }

      const [updated] = await db
        .update(ports)
        .set({
          name: v.name,
          country: v.country,
          unlocode: v.unlocode,
          defaultTimezone: v.defaultTimezone,
          defaultHolidayCalendarId: v.defaultHolidayCalendarId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(ports.id, id), eq(ports.organizationId, ctx.organizationId))
        )
        .returning({ id: ports.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Port not found.");
      }

      await recordAudit(ctx, {
        entityType: "Port",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

/**
 * Changes a port between active and inactive. Reactivation runs through the
 * same authorized path as deactivation.
 *
 * Setting a port to the status it already holds is not an error — the
 * administrator's intent is already satisfied — but it writes nothing and
 * records no audit entry. An audit trail that logs changes which did not
 * happen is harder to trust months later, when it is read to explain a
 * finalized statement.
 */
export async function setPortStatus(
  id: string,
  status: "active" | "inactive"
): Promise<ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return portAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "active" && status !== "inactive") {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: ports.status })
        .from(ports)
        .where(
          and(eq(ports.id, id), eq(ports.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Port not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      const [updated] = await db
        .update(ports)
        .set({ status, updatedAt: new Date() })
        .where(
          and(eq(ports.id, id), eq(ports.organizationId, ctx.organizationId))
        )
        .returning({ id: ports.id });

      if (!updated) {
        return fail<Out>("NOT_FOUND", "Port not found.");
      }

      await recordAudit(ctx, {
        entityType: "Port",
        entityId: id,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}
