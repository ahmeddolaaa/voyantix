/**
 * Internal helper (NOT "use server"): reads the organization's settlement
 * rounding convention. Called inside an already-authorized action with the
 * caller's own organizationId. An organization without a configuration row
 * gets the default (DECIMALS_5) — the same as the column default.
 */
import { db } from "@/db/client";
import { companyConfigurations } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  isSettlementDayPrecision,
  type SettlementDayPrecision,
} from "@/lib/laytime/settlement";

export async function loadSettlementDayPrecision(
  organizationId: string
): Promise<SettlementDayPrecision> {
  const [row] = await db
    .select({ p: companyConfigurations.settlementDayPrecision })
    .from(companyConfigurations)
    .where(eq(companyConfigurations.organizationId, organizationId));
  return row && isSettlementDayPrecision(row.p) ? row.p : "DECIMALS_5";
}
