"use server";

import { db } from "@/db/client";
import { holidayCalendars, holidays } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * HOLIDAY (DAY) ACTIONS - the line items inside a holiday calendar.
 * A holiday has no status and no lifecycle: it is added or removed, nothing
 * more (see schema header). Removal is therefore a hard delete, which is the
 * correct and only behaviour available for this table - not a policy breach.
 *
 * Holidays carry no organizationId of their own; they belong to a calendar.
 * Every operation first confirms the parent calendar exists and belongs to
 * the caller's organization, so a caller from another tenant sees NOT_FOUND
 * (never FORBIDDEN, never another org's data).
 */

export type HolidayRow = {
  id: string;
  date: string;
  label: string;
};

async function holidayAction<T>(
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

/**
 * Confirms a calendar exists within the caller's org. Returns the calendar
 * id on success; a NOT_FOUND ActionResult otherwise. Callers use this before
 * touching any of the calendar's days.
 */
async function assertCalendarInOrg(
  calendarId: string,
  organizationId: string
): Promise<ActionResult<{ id: string }>> {
  const found = await db
    .select({ id: holidayCalendars.id })
    .from(holidayCalendars)
    .where(
      and(
        eq(holidayCalendars.id, calendarId),
        eq(holidayCalendars.organizationId, organizationId)
      )
    );

  if (found.length === 0) {
    return fail<{ id: string }>("NOT_FOUND", "Calendar not found.");
  }
  return ok({ id: found[0].id });
}

export type HolidayInput = {
  date: string;
  label: string;
};

function validateHolidayInput(
  input: HolidayInput
): ActionResult<{ date: string; label: string }> {
  const date = (input.date ?? "").trim();
  if (date === "") {
    return fail("VALIDATION_ERROR", "Date is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail("VALIDATION_ERROR", "Date must be a valid calendar date.");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return fail("VALIDATION_ERROR", "Date must be a valid calendar date.");
  }

  const label = (input.label ?? "").trim();
  if (label === "") {
    return fail("VALIDATION_ERROR", "Label is required.");
  }
  if (label.length > 120) {
    return fail("VALIDATION_ERROR", "Label must be 120 characters or fewer.");
  }

  return ok({ date, label });
}

export async function listHolidays(
  calendarId: string
): Promise<ActionResult<HolidayRow[]>> {
  return holidayAction<HolidayRow[]>("masterdata.read", async (ctx) => {
    const guard = await assertCalendarInOrg(calendarId, ctx.organizationId);
    if (!guard.ok) return fail<HolidayRow[]>(guard.code, guard.message);

    const rows = await db
      .select({
        id: holidays.id,
        date: holidays.date,
        label: holidays.label,
      })
      .from(holidays)
      .where(eq(holidays.holidayCalendarId, calendarId))
      .orderBy(asc(holidays.date));

    return ok(rows as HolidayRow[]);
  });
}

export async function addHoliday(
  calendarId: string,
  input: HolidayInput
): Promise<ActionResult<{ id: string }>> {
  return holidayAction<{ id: string }>("masterdata.write", async (ctx) => {
    const guard = await assertCalendarInOrg(calendarId, ctx.organizationId);
    if (!guard.ok) return fail<{ id: string }>(guard.code, guard.message);

    const validated = validateHolidayInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(holidays)
        .values({
          holidayCalendarId: calendarId,
          date: v.date,
          label: v.label,
        })
        .returning({ id: holidays.id });

      await recordAudit(ctx, {
        entityType: "Holiday",
        entityId: created.id,
        action: "create",
        after: { calendarId, ...v },
      });

      return ok({ id: created.id });
    });
  });
}

export async function deleteHoliday(
  holidayId: string
): Promise<ActionResult<{ id: string }>> {
  return holidayAction<{ id: string }>("masterdata.write", async (ctx) => {
    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          id: holidays.id,
          date: holidays.date,
          label: holidays.label,
          calendarId: holidays.holidayCalendarId,
          organizationId: holidayCalendars.organizationId,
        })
        .from(holidays)
        .innerJoin(
          holidayCalendars,
          eq(holidays.holidayCalendarId, holidayCalendars.id)
        )
        .where(eq(holidays.id, holidayId));

      if (
        existing.length === 0 ||
        existing[0].organizationId !== ctx.organizationId
      ) {
        return fail<{ id: string }>("NOT_FOUND", "Holiday not found.");
      }

      await db.delete(holidays).where(eq(holidays.id, holidayId));

      await recordAudit(ctx, {
        entityType: "Holiday",
        entityId: holidayId,
        action: "delete",
        before: {
          calendarId: existing[0].calendarId,
          date: existing[0].date,
          label: existing[0].label,
        },
      });

      return ok({ id: holidayId });
    });
  });
}