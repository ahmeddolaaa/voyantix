"use server";

import { db } from "@/db/client";
import { contracts } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * CONTRACT — fixture header. Identity of a fixture: reference, counterparty,
 * date. Not versioned; commercial values live on ContractLaytimeTerm.
 *
 * Reference is unique within the organization, normalized for case and
 * whitespace (contracts_org_reference_unique_idx -> DUPLICATE_CODE).
 *
 * The contract has a real active/inactive status column, so setStatus is a
 * genuine operation here (unlike LaytimeRuleSet, which has no status). No
 * hard delete — a contract with history is archived, not removed.
 */

export type ContractRow = {
  id: string;
  reference: string;
  counterparty: string;
  contractDate: string | null;
  status: "active" | "inactive";
};

async function contractAction<T>(
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

export type ContractInput = {
  reference: string;
  counterparty: string;
  contractDate?: string | null;
};

function validateContractInput(
  input: ContractInput
): ActionResult<{ reference: string; counterparty: string; contractDate: string | null }> {
  const reference = (input.reference ?? "").trim();
  if (reference === "") {
    return fail("VALIDATION_ERROR", "Contract reference is required.");
  }
  if (reference.length > 120) {
    return fail("VALIDATION_ERROR", "Contract reference must be 120 characters or fewer.");
  }

  const counterparty = (input.counterparty ?? "").trim();
  if (counterparty === "") {
    return fail("VALIDATION_ERROR", "Counterparty is required.");
  }
  if (counterparty.length > 200) {
    return fail("VALIDATION_ERROR", "Counterparty must be 200 characters or fewer.");
  }

  const rawDate = (input.contractDate ?? "").trim();
  const contractDate = rawDate === "" ? null : rawDate;

  return ok({ reference, counterparty, contractDate });
}

export async function listContracts(
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<ContractRow[]>> {
  return contractAction<ContractRow[]>("masterdata.read", async (ctx) => {
    const scope = options.includeInactive
      ? eq(contracts.organizationId, ctx.organizationId)
      : and(
          eq(contracts.organizationId, ctx.organizationId),
          eq(contracts.status, "active")
        );

    const rows = await db
      .select({
        id: contracts.id,
        reference: contracts.reference,
        counterparty: contracts.counterparty,
        contractDate: contracts.contractDate,
        status: contracts.status,
      })
      .from(contracts)
      .where(scope)
      .orderBy(asc(contracts.reference));

    return ok(rows as ContractRow[]);
  });
}

export async function getContract(
  id: string
): Promise<ActionResult<ContractRow>> {
  return contractAction<ContractRow>("masterdata.read", async (ctx) => {
    const rows = await db
      .select({
        id: contracts.id,
        reference: contracts.reference,
        counterparty: contracts.counterparty,
        contractDate: contracts.contractDate,
        status: contracts.status,
      })
      .from(contracts)
      .where(and(eq(contracts.id, id), eq(contracts.organizationId, ctx.organizationId)));

    if (rows.length === 0) {
      return fail<ContractRow>("NOT_FOUND", "Contract not found.");
    }
    return ok(rows[0] as ContractRow);
  });
}

export async function createContract(
  input: ContractInput
): Promise<ActionResult<{ id: string }>> {
  return contractAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateContractInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(contracts)
        .values({
          organizationId: ctx.organizationId,
          reference: v.reference,
          counterparty: v.counterparty,
          contractDate: v.contractDate,
        })
        .returning({ id: contracts.id });

      await recordAudit(ctx, {
        entityType: "Contract",
        entityId: created.id,
        action: "create",
        after: v,
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateContract(
  id: string,
  input: ContractInput
): Promise<ActionResult<{ id: string }>> {
  return contractAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateContractInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          reference: contracts.reference,
          counterparty: contracts.counterparty,
          contractDate: contracts.contractDate,
        })
        .from(contracts)
        .where(and(eq(contracts.id, id), eq(contracts.organizationId, ctx.organizationId)));

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Contract not found.");
      }

      const [updated] = await db
        .update(contracts)
        .set({
          reference: v.reference,
          counterparty: v.counterparty,
          contractDate: v.contractDate,
          updatedAt: new Date(),
        })
        .where(and(eq(contracts.id, id), eq(contracts.organizationId, ctx.organizationId)))
        .returning({ id: contracts.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Contract not found.");
      }

      await recordAudit(ctx, {
        entityType: "Contract",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setContractStatus(
  id: string,
  status: "active" | "inactive"
): Promise<ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return contractAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "active" && status !== "inactive") {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: contracts.status })
        .from(contracts)
        .where(and(eq(contracts.id, id), eq(contracts.organizationId, ctx.organizationId)));

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Contract not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      await db
        .update(contracts)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(contracts.id, id), eq(contracts.organizationId, ctx.organizationId)));

      await recordAudit(ctx, {
        entityType: "Contract",
        entityId: id,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}