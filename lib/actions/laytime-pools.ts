"use server";

import { db } from "@/db/client";
import { contracts, laytimePools } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * LAYTIME POOL — reversible allowance pool. CONTRACT-OWNED: a pool belongs
 * to exactly one contract; several ContractLaytimeTerm rows of that same
 * contract may reference it. Not organization-global, not term-owned.
 *
 * This layer stores CONFIGURATION only — totalAllowance, allowanceUnit,
 * settlementPolicy. It implements no reversible calculation, no pool
 * consumption, and no settlement semantics. settlementPolicy is free text:
 * its vocabulary is withheld (B7) and is not invented here.
 *
 * There is no status column and no setStatus (schema decision, like the
 * rule set). No hard delete. A pool's contract is fixed at creation and is
 * never moved — update touches only the editable fields.
 *
 * Name is unique within a contract (laytime_pools_contract_name_unique_idx
 * -> DUPLICATE_NAME).
 */

export type LaytimePoolRow = {
  id: string;
  contractId: string;
  name: string;
  totalAllowance: string;
  allowanceUnit: string;
  settlementPolicy: string;
};

async function poolAction<T>(
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

export type LaytimePoolInput = {
  name: string;
  totalAllowance: string;
  allowanceUnit: string;
  settlementPolicy: string;
};

function validatePoolInput(
  input: LaytimePoolInput
): ActionResult<{
  name: string;
  totalAllowance: string;
  allowanceUnit: string;
  settlementPolicy: string;
}> {
  const name = (input.name ?? "").trim();
  if (name === "") {
    return fail("VALIDATION_ERROR", "Pool name is required.");
  }
  if (name.length > 120) {
    return fail("VALIDATION_ERROR", "Pool name must be 120 characters or fewer.");
  }

  const totalAllowance = (input.totalAllowance ?? "").trim();
  // A numeric string the database will accept; reject anything non-numeric
  // here so it never reaches Postgres as a cast error.
  if (totalAllowance === "" || !/^-?\d+(\.\d+)?$/.test(totalAllowance)) {
    return fail("VALIDATION_ERROR", "Total allowance must be a number.");
  }

  const allowanceUnit = (input.allowanceUnit ?? "").trim();
  if (allowanceUnit === "") {
    return fail("VALIDATION_ERROR", "Allowance unit is required.");
  }
  if (allowanceUnit.length > 60) {
    return fail("VALIDATION_ERROR", "Allowance unit must be 60 characters or fewer.");
  }

  const settlementPolicy = (input.settlementPolicy ?? "").trim();
  if (settlementPolicy === "") {
    return fail("VALIDATION_ERROR", "Settlement policy is required.");
  }
  if (settlementPolicy.length > 60) {
    return fail("VALIDATION_ERROR", "Settlement policy must be 60 characters or fewer.");
  }

  return ok({ name, totalAllowance, allowanceUnit, settlementPolicy });
}

/** True when the contract exists in the caller's organization. */
async function contractInOrg(
  contractId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(
      and(
        eq(contracts.id, contractId),
        eq(contracts.organizationId, organizationId)
      )
    );
  return rows.length > 0;
}

export async function listLaytimePools(
  contractId: string
): Promise<ActionResult<LaytimePoolRow[]>> {
  return poolAction<LaytimePoolRow[]>("masterdata.read", async (ctx) => {
    if (!(await contractInOrg(contractId, ctx.organizationId))) {
      return fail<LaytimePoolRow[]>("NOT_FOUND", "Contract not found.");
    }

    const rows = await db
      .select({
        id: laytimePools.id,
        contractId: laytimePools.contractId,
        name: laytimePools.name,
        totalAllowance: laytimePools.totalAllowance,
        allowanceUnit: laytimePools.allowanceUnit,
        settlementPolicy: laytimePools.settlementPolicy,
      })
      .from(laytimePools)
      .where(
        and(
          eq(laytimePools.contractId, contractId),
          eq(laytimePools.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(laytimePools.name));

    return ok(rows as LaytimePoolRow[]);
  });
}

export async function createLaytimePool(
  contractId: string,
  input: LaytimePoolInput
): Promise<ActionResult<{ id: string }>> {
  return poolAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validatePoolInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    // Establish the contract belongs to this org before creating the pool.
    if (!(await contractInOrg(contractId, ctx.organizationId))) {
      return fail<{ id: string }>("NOT_FOUND", "Contract not found.");
    }

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(laytimePools)
        .values({
          organizationId: ctx.organizationId,
          contractId,
          name: v.name,
          totalAllowance: v.totalAllowance,
          allowanceUnit: v.allowanceUnit,
          settlementPolicy: v.settlementPolicy,
        })
        .returning({ id: laytimePools.id });

      await recordAudit(ctx, {
        entityType: "LaytimePool",
        entityId: created.id,
        action: "create",
        after: { contractId, ...v },
      });

      return ok({ id: created.id });
    });
  });
}

/**
 * Updates the editable fields of a pool. The pool's contract is fixed: the
 * update payload has no contractId, so a pool can never be moved to another
 * contract through this action.
 */
export async function updateLaytimePool(
  poolId: string,
  input: LaytimePoolInput
): Promise<ActionResult<{ id: string }>> {
  return poolAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validatePoolInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          name: laytimePools.name,
          totalAllowance: laytimePools.totalAllowance,
          allowanceUnit: laytimePools.allowanceUnit,
          settlementPolicy: laytimePools.settlementPolicy,
        })
        .from(laytimePools)
        .where(
          and(
            eq(laytimePools.id, poolId),
            eq(laytimePools.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Pool not found.");
      }

      const [updated] = await db
        .update(laytimePools)
        .set({
          name: v.name,
          totalAllowance: v.totalAllowance,
          allowanceUnit: v.allowanceUnit,
          settlementPolicy: v.settlementPolicy,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(laytimePools.id, poolId),
            eq(laytimePools.organizationId, ctx.organizationId)
          )
        )
        .returning({ id: laytimePools.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Pool not found.");
      }

      await recordAudit(ctx, {
        entityType: "LaytimePool",
        entityId: poolId,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}