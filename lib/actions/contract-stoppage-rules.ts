"use server";

import { db } from "@/db/client";
import {
  contractStoppageRules,
  contractLaytimeTerms,
} from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * CONTRACT STOPPAGE RULE — how a stoppage reason is treated for a term (F11:
 * countability lives with the term, never on the reason). One rule per (term,
 * reason). The laytime engine reads these at calculation time and refuses to
 * calculate a stopped interval whose reason has no rule.
 *
 * `AlwaysExcluded` and `NeverExcluded` are defined; `CountsAgainstOwner` is
 * storable but its balance effect is deliberately left for the engine to
 * refuse until real charterparty evidence establishes it.
 */

export type StoppageCountability =
  | "AlwaysExcluded"
  | "NeverExcluded"
  | "CountsAgainstOwner";

const COUNTABILITY_VALUES: readonly StoppageCountability[] = [
  "AlwaysExcluded",
  "NeverExcluded",
  "CountsAgainstOwner",
];

export type ContractStoppageRuleRow = {
  id: string;
  termId: string;
  stoppageReasonId: string;
  countability: StoppageCountability;
  /** OODAOD exception: still interrupts time once on demurrage. */
  excludedOnDemurrage: boolean;
};

async function ruleAction<T>(
  permission: Parameters<typeof authorized>[0],
  fn: Parameters<typeof authorized<ActionResult<T>>>[1]
): Promise<ActionResult<T>> {
  try {
    return await authorized<ActionResult<T>>(permission, fn);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<T>("FORBIDDEN", "You do not have permission to perform this action.");
    }
    throw e;
  }
}

/** Confirms the term exists inside the caller's organization. */
async function termInOrg(termId: string, organizationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: contractLaytimeTerms.id })
    .from(contractLaytimeTerms)
    .where(
      and(
        eq(contractLaytimeTerms.id, termId),
        eq(contractLaytimeTerms.organizationId, organizationId)
      )
    );
  return rows.length > 0;
}

export async function listStoppageRules(
  termId: string
): Promise<ActionResult<ContractStoppageRuleRow[]>> {
  return ruleAction<ContractStoppageRuleRow[]>("masterdata.read", async (ctx) => {
    if (!(await termInOrg(termId, ctx.organizationId))) {
      return fail<ContractStoppageRuleRow[]>("NOT_FOUND", "Laytime term not found.");
    }
    const rows = await db
      .select({
        id: contractStoppageRules.id,
        termId: contractStoppageRules.termId,
        stoppageReasonId: contractStoppageRules.stoppageReasonId,
        countability: contractStoppageRules.countability,
        excludedOnDemurrage: contractStoppageRules.excludedOnDemurrage,
      })
      .from(contractStoppageRules)
      .where(
        and(
          eq(contractStoppageRules.termId, termId),
          eq(contractStoppageRules.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(contractStoppageRules.stoppageReasonId));
    return ok(rows as ContractStoppageRuleRow[]);
  });
}

export type SetStoppageRuleInput = {
  stoppageReasonId: string;
  countability: StoppageCountability;
  /** Only meaningful for AlwaysExcluded; forced false otherwise. */
  excludedOnDemurrage?: boolean;
};

/**
 * Upserts the countability rule for a (term, reason): one rule per pair, so
 * setting it again updates the existing rule rather than creating a duplicate.
 */
export async function setStoppageRule(
  termId: string,
  input: SetStoppageRuleInput
): Promise<ActionResult<{ id: string }>> {
  return ruleAction<{ id: string }>("masterdata.write", async (ctx) => {
    const reasonId = (input.stoppageReasonId ?? "").trim();
    if (reasonId === "") {
      return fail<{ id: string }>("VALIDATION_ERROR", "A stoppage reason is required.");
    }
    if (!COUNTABILITY_VALUES.includes(input.countability)) {
      return fail<{ id: string }>("VALIDATION_ERROR", "An invalid countability was provided.");
    }
    if (!(await termInOrg(termId, ctx.organizationId))) {
      return fail<{ id: string }>("NOT_FOUND", "Laytime term not found.");
    }

    const excludedOnDemurrage =
      input.countability === "AlwaysExcluded" && input.excludedOnDemurrage === true;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [row] = await db
        .insert(contractStoppageRules)
        .values({
          organizationId: ctx.organizationId,
          termId,
          stoppageReasonId: reasonId,
          countability: input.countability,
          excludedOnDemurrage,
        })
        .onConflictDoUpdate({
          target: [contractStoppageRules.termId, contractStoppageRules.stoppageReasonId],
          set: { countability: input.countability, excludedOnDemurrage, updatedAt: new Date() },
        })
        .returning({ id: contractStoppageRules.id });

      await recordAudit(ctx, {
        entityType: "ContractStoppageRule",
        entityId: row.id,
        action: "set",
        after: {
          termId,
          stoppageReasonId: reasonId,
          countability: input.countability,
          excludedOnDemurrage,
        },
      });
      return ok({ id: row.id });
    });
  });
}

export async function deleteStoppageRule(
  id: string
): Promise<ActionResult<{ id: string }>> {
  return ruleAction<{ id: string }>("masterdata.write", async (ctx) => {
    const [row] = await db
      .delete(contractStoppageRules)
      .where(
        and(
          eq(contractStoppageRules.id, id),
          eq(contractStoppageRules.organizationId, ctx.organizationId)
        )
      )
      .returning({ id: contractStoppageRules.id });
    if (!row) {
      return fail<{ id: string }>("NOT_FOUND", "Stoppage rule not found.");
    }
    await recordAudit(ctx, {
      entityType: "ContractStoppageRule",
      entityId: row.id,
      action: "delete",
    });
    return ok({ id: row.id });
  });
}
