"use server";

import { db } from "@/db/client";
import { companyConfigurations } from "@/db/schema";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { isSettlementDayPrecision, type SettlementDayPrecision } from "@/lib/laytime/settlement";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";
import { loadSettlementDayPrecision } from "./_settlement-precision";

/**
 * SETTLEMENT SETTINGS — organization-level rounding convention for
 * demurrage/despatch (see lib/laytime/settlement.ts). Admin only.
 * Changing it affects statements built or rebuilt afterwards; a finalized
 * statement keeps its stored amounts.
 */

export type SettlementSettings = { dayPrecision: SettlementDayPrecision };

async function settingsAction<T>(
  fn: Parameters<typeof authorized<ActionResult<T>>>[1]
): Promise<ActionResult<T>> {
  try {
    return await authorized<ActionResult<T>>("admin.configuration", fn);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<T>("FORBIDDEN", "You do not have permission to perform this action.");
    }
    throw e;
  }
}

export async function getSettlementSettings(): Promise<ActionResult<SettlementSettings>> {
  return settingsAction(async (ctx) =>
    ok({ dayPrecision: await loadSettlementDayPrecision(ctx.organizationId) })
  );
}

export async function updateSettlementDayPrecision(
  dayPrecision: string
): Promise<ActionResult<SettlementSettings>> {
  return settingsAction(async (ctx) => {
    if (!isSettlementDayPrecision(dayPrecision)) {
      return fail<SettlementSettings>("VALIDATION_ERROR", "Unknown rounding option.");
    }
    return withDatabaseErrors(async () => {
      const before = await loadSettlementDayPrecision(ctx.organizationId);
      const [row] = await db
        .insert(companyConfigurations)
        .values({ organizationId: ctx.organizationId, settlementDayPrecision: dayPrecision })
        .onConflictDoUpdate({
          target: companyConfigurations.organizationId,
          set: { settlementDayPrecision: dayPrecision, updatedAt: new Date() },
        })
        .returning({ id: companyConfigurations.id });
      await recordAudit(ctx, {
        entityType: "company_configuration",
        entityId: row.id,
        action: "update_settlement_day_precision",
        before: { dayPrecision: before },
        after: { dayPrecision },
      });
      return ok({ dayPrecision });
    });
  });
}
