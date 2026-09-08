"use server";

import { db } from "@/db/client";
import { holidayCalendars } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";

/**
 * Lookup data the Port screen needs beyond ports themselves.
 *
 * Only ACTIVE calendars are returned: this list populates a choice for new
 * and edited records, and a deactivated calendar should not be offered as a
 * fresh selection. A port already pointing at a calendar that was since
 * deactivated keeps that reference — deactivation never rewrites existing
 * data — and the port screen shows the stored name from its own query.
 */
export type CalendarOption = {
  id: string;
  name: string;
};

export async function listHolidayCalendarOptions(): Promise<
  ActionResult<CalendarOption[]>
> {
  try {
    return await authorized<ActionResult<CalendarOption[]>>(
      "masterdata.read",
      async (ctx) => {
        const rows = await db
          .select({ id: holidayCalendars.id, name: holidayCalendars.name })
          .from(holidayCalendars)
          .where(
            and(
              eq(holidayCalendars.organizationId, ctx.organizationId),
              eq(holidayCalendars.status, "active")
            )
          )
          .orderBy(asc(holidayCalendars.name));

        return ok(rows);
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<CalendarOption[]>(
        "FORBIDDEN",
        "You do not have permission to view holiday calendars."
      );
    }
    throw e;
  }
}
