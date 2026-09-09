"use server";

import { db } from "@/db/client";
import { holidayCalendars } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * HOLIDAY CALENDAR MASTER DATA - the container.
 * A calendar is a named set of holidays a port can default to. The days
 * themselves live in the holidays table and are managed per calendar
 * (see holidays actions). This file owns the calendar level only:
 * list, create, rename, activate/deactivate.
 * Name is unique within the organization, normalized for case and whitespace.
 */

export type HolidayCalendarRow = {
  id: string;
  name: string;
  status: "active" | "inactive";
};

async function holidayCalendarAction<T>(
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

export type HolidayCalendarInput = {
  name: string;
};

function validateHolidayCalendarInput(
  input: HolidayCalendarInput
): ActionResult<{ name: string }> {
  const name = (input.name ?? "").trim();
  if (name === "") {
    return fail("VALIDATION_ERROR", "Calendar name is required.");
  }
  if (name.length > 120) {
    return fail("VALIDATION_ERROR", "Calendar name must be 120 characters or fewer.");
  }
  return ok({ name });
}

export async function listHolidayCalendars(
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<HolidayCalendarRow[]>> {
  return holidayCalendarAction<HolidayCalendarRow[]>("masterdata.read", async (ctx) => {
    const scope = options.includeInactive
      ? eq(holidayCalendars.organizationId, ctx.organizationId)
      : and(
          eq(holidayCalendars.organizationId, ctx.organizationId),
          eq(holidayCalendars.status, "active")
        );

    const rows = await db
      .select({
        id: holidayCalendars.id,
        name: holidayCalendars.name,
        status: holidayCalendars.status,
      })
      .from(holidayCalendars)
      .where(scope)
      .orderBy(asc(holidayCalendars.name));

    return ok(rows as HolidayCalendarRow[]);
  });
}

export async function getHolidayCalendar(
  id: string
): Promise<ActionResult<HolidayCalendarRow>> {
  return holidayCalendarAction<HolidayCalendarRow>("masterdata.read", async (ctx) => {
    const rows = await db
      .select({
        id: holidayCalendars.id,
        name: holidayCalendars.name,
        status: holidayCalendars.status,
      })
      .from(holidayCalendars)
      .where(
        and(eq(holidayCalendars.id, id), eq(holidayCalendars.organizationId, ctx.organizationId))
      );

    if (rows.length === 0) {
      return fail<HolidayCalendarRow>("NOT_FOUND", "Calendar not found.");
    }
    return ok(rows[0] as HolidayCalendarRow);
  });
}

export async function createHolidayCalendar(
  input: HolidayCalendarInput
): Promise<ActionResult<{ id: string }>> {
  return holidayCalendarAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateHolidayCalendarInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(holidayCalendars)
        .values({
          organizationId: ctx.organizationId,
          name: v.name,
        })
        .returning({ id: holidayCalendars.id });

      await recordAudit(ctx, {
        entityType: "HolidayCalendar",
        entityId: created.id,
        action: "create",
        after: v,
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateHolidayCalendar(
  id: string,
  input: HolidayCalendarInput
): Promise<ActionResult<{ id: string }>> {
  return holidayCalendarAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateHolidayCalendarInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({ name: holidayCalendars.name })
        .from(holidayCalendars)
        .where(
          and(eq(holidayCalendars.id, id), eq(holidayCalendars.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Calendar not found.");
      }

      const [updated] = await db
        .update(holidayCalendars)
        .set({ name: v.name, updatedAt: new Date() })
        .where(
          and(eq(holidayCalendars.id, id), eq(holidayCalendars.organizationId, ctx.organizationId))
        )
        .returning({ id: holidayCalendars.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Calendar not found.");
      }

      await recordAudit(ctx, {
        entityType: "HolidayCalendar",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setHolidayCalendarStatus(
  id: string,
  status: "active" | "inactive"
): Promise<ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return holidayCalendarAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "active" && status !== "inactive") {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: holidayCalendars.status })
        .from(holidayCalendars)
        .where(
          and(eq(holidayCalendars.id, id), eq(holidayCalendars.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Calendar not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      await db
        .update(holidayCalendars)
        .set({ status, updatedAt: new Date() })
        .where(
          and(eq(holidayCalendars.id, id), eq(holidayCalendars.organizationId, ctx.organizationId))
        );

      await recordAudit(ctx, {
        entityType: "HolidayCalendar",
        entityId: id,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}