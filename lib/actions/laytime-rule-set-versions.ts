"use server";

import { db } from "@/db/client";
import {
  laytimeRuleSets,
  laytimeRuleSetVersions,
  contractLaytimeTerms,
} from "@/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * LAYTIME RULE SET VERSION — an immutable-once-referenced snapshot of the
 * reusable semantics of a rule set.
 *
 * IMMUTABILITY MODEL (roadmap F13, model B):
 *   - A version is editable in place ONLY while no ContractLaytimeTerm
 *     references it.
 *   - Once any term references it, the version is frozen: an update creates
 *     a NEW version carrying the edited values, leaving the referenced one
 *     untouched. The term that pointed at the old version keeps pointing at
 *     it (historical reproducibility, F20); moving a term to a new version
 *     is a separate, explicit term edit.
 *
 * versionNumber is sequential within a rule set, assigned inside the same
 * transaction as the insert so concurrent creates cannot collide (the
 * unique index on (rule_set_id, version_number) is the backstop).
 *
 * These rows carry reusable SEMANTICS as data (excludedWeekdays, holidays,
 * EIU, weather, working-day window). No engine rule meaning is encoded here;
 * the withheld rules (B1-B5) live in the Phase 6 engine.
 *
 * No status field and no delete: lifecycle is expressed only through
 * versioning.
 */

export type RuleSetVersionRow = {
  id: string;
  ruleSetId: string;
  versionNumber: number;
  excludedWeekdays: number[];
  excludeHolidays: boolean;
  eiuApplies: boolean;
  weatherApplies: boolean;
  workingDayStart: string | null;
  workingDayEnd: string | null;
  holidayCalendarId: string | null;
};

async function versionAction<T>(
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

export type RuleSetVersionInput = {
  excludedWeekdays?: number[];
  excludeHolidays?: boolean;
  eiuApplies?: boolean;
  weatherApplies?: boolean;
  workingDayStart?: string | null;
  workingDayEnd?: string | null;
  holidayCalendarId?: string | null;
};

type ValidatedVersion = {
  excludedWeekdays: number[];
  excludeHolidays: boolean;
  eiuApplies: boolean;
  weatherApplies: boolean;
  workingDayStart: string | null;
  workingDayEnd: string | null;
  holidayCalendarId: string | null;
};

function validateVersionInput(
  input: RuleSetVersionInput
): ActionResult<ValidatedVersion> {
  const weekdays = input.excludedWeekdays ?? [];
  for (const d of weekdays) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      return fail(
        "VALIDATION_ERROR",
        "Excluded weekdays must be integers from 0 (Sunday) to 6 (Saturday)."
      );
    }
  }
  // Normalize: unique, sorted. This is data hygiene, not rule meaning.
  const excludedWeekdays = [...new Set(weekdays)].sort((a, b) => a - b);

  const start = input.workingDayStart ?? null;
  const end = input.workingDayEnd ?? null;
  // Both present or both absent — a half-open working day is meaningless.
  if ((start === null) !== (end === null)) {
    return fail(
      "VALIDATION_ERROR",
      "Working day start and end must be set together, or both left empty."
    );
  }

  return ok({
    excludedWeekdays,
    excludeHolidays: input.excludeHolidays === true,
    eiuApplies: input.eiuApplies === true,
    weatherApplies: input.weatherApplies === true,
    workingDayStart: start,
    workingDayEnd: end,
    holidayCalendarId: input.holidayCalendarId ?? null,
  });
}

/** Confirms the rule set exists in the caller's org. Returns NOT_FOUND
 *  otherwise (never leaks another tenant's rule set). */
async function assertRuleSetInOrg(
  ruleSetId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: laytimeRuleSets.id })
    .from(laytimeRuleSets)
    .where(
      and(
        eq(laytimeRuleSets.id, ruleSetId),
        eq(laytimeRuleSets.organizationId, organizationId)
      )
    );
  return rows.length > 0;
}

export async function listRuleSetVersions(
  ruleSetId: string
): Promise<ActionResult<RuleSetVersionRow[]>> {
  return versionAction<RuleSetVersionRow[]>("masterdata.read", async (ctx) => {
    if (!(await assertRuleSetInOrg(ruleSetId, ctx.organizationId))) {
      return fail<RuleSetVersionRow[]>("NOT_FOUND", "Rule set not found.");
    }

    const rows = await db
      .select({
        id: laytimeRuleSetVersions.id,
        ruleSetId: laytimeRuleSetVersions.ruleSetId,
        versionNumber: laytimeRuleSetVersions.versionNumber,
        excludedWeekdays: laytimeRuleSetVersions.excludedWeekdays,
        excludeHolidays: laytimeRuleSetVersions.excludeHolidays,
        eiuApplies: laytimeRuleSetVersions.eiuApplies,
        weatherApplies: laytimeRuleSetVersions.weatherApplies,
        workingDayStart: laytimeRuleSetVersions.workingDayStart,
        workingDayEnd: laytimeRuleSetVersions.workingDayEnd,
        holidayCalendarId: laytimeRuleSetVersions.holidayCalendarId,
      })
      .from(laytimeRuleSetVersions)
      .where(
        and(
          eq(laytimeRuleSetVersions.ruleSetId, ruleSetId),
          eq(laytimeRuleSetVersions.organizationId, ctx.organizationId)
        )
      )
      .orderBy(desc(laytimeRuleSetVersions.versionNumber));

    return ok(rows as RuleSetVersionRow[]);
  });
}

/** Inserts a new version with the next sequential number, inside a
 *  transaction so concurrent creates cannot pick the same number. */
async function insertNextVersion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  ruleSetId: string,
  v: ValidatedVersion
): Promise<{ id: string; versionNumber: number }> {
  const [{ next }] = await tx
    .select({
      next: sql<number>`coalesce(max(${laytimeRuleSetVersions.versionNumber}), 0) + 1`,
    })
    .from(laytimeRuleSetVersions)
    .where(
      and(
        eq(laytimeRuleSetVersions.ruleSetId, ruleSetId),
        eq(laytimeRuleSetVersions.organizationId, organizationId)
      )
    );

  const [created] = await tx
    .insert(laytimeRuleSetVersions)
    .values({
      organizationId,
      ruleSetId,
      versionNumber: next,
      excludedWeekdays: v.excludedWeekdays,
      excludeHolidays: v.excludeHolidays,
      eiuApplies: v.eiuApplies,
      weatherApplies: v.weatherApplies,
      workingDayStart: v.workingDayStart,
      workingDayEnd: v.workingDayEnd,
      holidayCalendarId: v.holidayCalendarId,
    })
    .returning({
      id: laytimeRuleSetVersions.id,
      versionNumber: laytimeRuleSetVersions.versionNumber,
    });

  return created;
}

export async function createRuleSetVersion(
  ruleSetId: string,
  input: RuleSetVersionInput
): Promise<ActionResult<{ id: string; versionNumber: number }>> {
  type Out = { id: string; versionNumber: number };
  return versionAction<Out>("masterdata.write", async (ctx) => {
    const validated = validateVersionInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    if (!(await assertRuleSetInOrg(ruleSetId, ctx.organizationId))) {
      return fail<Out>("NOT_FOUND", "Rule set not found.");
    }

    return withDatabaseErrors<Out>(async () => {
      const created = await db.transaction((tx) =>
        insertNextVersion(tx, ctx.organizationId, ruleSetId, v)
      );

      await recordAudit(ctx, {
        entityType: "LaytimeRuleSetVersion",
        entityId: created.id,
        action: "create",
        after: { ruleSetId, versionNumber: created.versionNumber, ...v },
      });

      return ok(created);
    });
  });
}

/** True when at least one ContractLaytimeTerm in this org references the
 *  version — the point at which it becomes immutable. */
async function isVersionReferenced(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  versionId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await tx
    .select({ id: contractLaytimeTerms.id })
    .from(contractLaytimeTerms)
    .where(
      and(
        eq(contractLaytimeTerms.ruleSetVersionId, versionId),
        eq(contractLaytimeTerms.organizationId, organizationId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Updates a version. If it is not yet referenced by any term, it is edited
 * in place. If it is referenced, it is frozen: a new version is created with
 * the edited values and returned, and the referenced one is left untouched.
 *
 * `created` in the result tells the caller which path ran.
 */
export async function updateRuleSetVersion(
  versionId: string,
  input: RuleSetVersionInput
): Promise<ActionResult<{ id: string; versionNumber: number; created: boolean }>> {
  type Out = { id: string; versionNumber: number; created: boolean };
  return versionAction<Out>("masterdata.write", async (ctx) => {
    const validated = validateVersionInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<Out>(async () => {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({
            ruleSetId: laytimeRuleSetVersions.ruleSetId,
            versionNumber: laytimeRuleSetVersions.versionNumber,
          })
          .from(laytimeRuleSetVersions)
          .where(
            and(
              eq(laytimeRuleSetVersions.id, versionId),
              eq(laytimeRuleSetVersions.organizationId, ctx.organizationId)
            )
          );

        if (existing.length === 0) {
          return fail<Out>("NOT_FOUND", "Rule set version not found.");
        }
        const current = existing[0];

        const referenced = await isVersionReferenced(
          tx,
          versionId,
          ctx.organizationId
        );

        if (referenced) {
          // Frozen: create a new version, leave the old one untouched.
          const created = await insertNextVersion(
            tx,
            ctx.organizationId,
            current.ruleSetId,
            v
          );
          await recordAudit(ctx, {
            entityType: "LaytimeRuleSetVersion",
            entityId: created.id,
            action: "create",
            after: {
              ruleSetId: current.ruleSetId,
              versionNumber: created.versionNumber,
              supersedesVersionId: versionId,
              ...v,
            },
          });
          return ok({ ...created, created: true });
        }

        // Not referenced: edit in place, keep the same version number.
        await tx
          .update(laytimeRuleSetVersions)
          .set({
            excludedWeekdays: v.excludedWeekdays,
            excludeHolidays: v.excludeHolidays,
            eiuApplies: v.eiuApplies,
            weatherApplies: v.weatherApplies,
            workingDayStart: v.workingDayStart,
            workingDayEnd: v.workingDayEnd,
            holidayCalendarId: v.holidayCalendarId,
          })
          .where(
            and(
              eq(laytimeRuleSetVersions.id, versionId),
              eq(laytimeRuleSetVersions.organizationId, ctx.organizationId)
            )
          );

        await recordAudit(ctx, {
          entityType: "LaytimeRuleSetVersion",
          entityId: versionId,
          action: "update",
          after: { versionNumber: current.versionNumber, ...v },
        });

        return ok({
          id: versionId,
          versionNumber: current.versionNumber,
          created: false,
        });
      });
    });
  });
}