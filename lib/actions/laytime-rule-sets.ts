"use server";

import { db } from "@/db/client";
import { laytimeRuleSets } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * LAYTIME RULE SET — reusable named container for laytime semantics.
 *
 * This action layer manages the HEADER only (name + description). The
 * reusable semantics live on LaytimeRuleSetVersion, implemented separately.
 *
 * The RuleSet header has NO status/lifecycle field by deliberate decision
 * (roadmap PO6): a RuleSet active/inactive lifecycle would carry unfrozen
 * semantics (can new terms reference an inactive set? do existing terms
 * still resolve? etc.), so it is not invented here. There is therefore no
 * setStatus action, and none should be added by analogy to simpler
 * master-data entities.
 *
 * Name is unique within the organization, normalized for case and
 * whitespace (laytime_rule_sets_org_name_unique_idx).
 */

export type LaytimeRuleSetRow = {
  id: string;
  name: string;
  description: string | null;
};

async function ruleSetAction<T>(
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

export type LaytimeRuleSetInput = {
  name: string;
  description?: string | null;
};

function validateRuleSetInput(
  input: LaytimeRuleSetInput
): ActionResult<{ name: string; description: string | null }> {
  const name = (input.name ?? "").trim();
  if (name === "") {
    return fail("VALIDATION_ERROR", "Rule set name is required.");
  }
  if (name.length > 120) {
    return fail("VALIDATION_ERROR", "Rule set name must be 120 characters or fewer.");
  }

  const rawDescription = (input.description ?? "").trim();
  const description = rawDescription === "" ? null : rawDescription;
  if (description !== null && description.length > 500) {
    return fail("VALIDATION_ERROR", "Description must be 500 characters or fewer.");
  }

  return ok({ name, description });
}

export async function listLaytimeRuleSets(): Promise<ActionResult<LaytimeRuleSetRow[]>> {
  return ruleSetAction<LaytimeRuleSetRow[]>("masterdata.read", async (ctx) => {
    const rows = await db
      .select({
        id: laytimeRuleSets.id,
        name: laytimeRuleSets.name,
        description: laytimeRuleSets.description,
      })
      .from(laytimeRuleSets)
      .where(eq(laytimeRuleSets.organizationId, ctx.organizationId))
      .orderBy(asc(laytimeRuleSets.name));

    return ok(rows as LaytimeRuleSetRow[]);
  });
}

export async function createLaytimeRuleSet(
  input: LaytimeRuleSetInput
): Promise<ActionResult<{ id: string }>> {
  return ruleSetAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateRuleSetInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(laytimeRuleSets)
        .values({
          organizationId: ctx.organizationId,
          name: v.name,
          description: v.description,
        })
        .returning({ id: laytimeRuleSets.id });

      await recordAudit(ctx, {
        entityType: "LaytimeRuleSet",
        entityId: created.id,
        action: "create",
        after: v,
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateLaytimeRuleSet(
  id: string,
  input: LaytimeRuleSetInput
): Promise<ActionResult<{ id: string }>> {
  return ruleSetAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateRuleSetInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          name: laytimeRuleSets.name,
          description: laytimeRuleSets.description,
        })
        .from(laytimeRuleSets)
        .where(
          and(
            eq(laytimeRuleSets.id, id),
            eq(laytimeRuleSets.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Rule set not found.");
      }

      const [updated] = await db
        .update(laytimeRuleSets)
        .set({ name: v.name, description: v.description, updatedAt: new Date() })
        .where(
          and(
            eq(laytimeRuleSets.id, id),
            eq(laytimeRuleSets.organizationId, ctx.organizationId)
          )
        )
        .returning({ id: laytimeRuleSets.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Rule set not found.");
      }

      await recordAudit(ctx, {
        entityType: "LaytimeRuleSet",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}