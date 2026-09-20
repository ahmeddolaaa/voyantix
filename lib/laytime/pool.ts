/**
 * POOL — reversible pooled laytime (Phase 6, pipeline step 9).
 *
 * When port calls share a poolId, their countable time is pooled against one
 * shared allowance and a single pooled balance is produced, while each port
 * call's contribution stays visible (Q18 baseline). A port call with no pool
 * (poolId = null) is balanced independently and never reaches this stage.
 *
 * Countable time is consumed chronologically across pool members; without a
 * once-on-demurrage behaviour (Q17 — deliberately NOT implemented), that
 * ordering does not change the pooled balance, which is the shared allowance
 * minus the members' total used time. The REPORTING ATTRIBUTION of any pool
 * overrun between member calls is deliberately left unresolved (Q18) — that is
 * a reporting concern, not a calculation blocker, and is not invented here.
 *
 * Selecting a pooled settlement rate when members carry different rates is a
 * separate settlement-policy decision (Phase 7), not part of this balance.
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

import { computeBalance, type Balance, type BalanceOutcome } from "./accumulate";

export type PoolMember = {
  portCallId: string;
  /** That member's counted time in seconds (from accumulateCountedSeconds). */
  usedSeconds: number;
};

export type PoolContribution = {
  portCallId: string;
  usedSeconds: number;
};

export type PoolResult = Balance & {
  /** Each member's counted-time contribution, order preserved. */
  contributions: PoolContribution[];
};

/**
 * Pools members' used time against the shared allowance (in seconds) and
 * returns the pooled balance plus each member's visible contribution.
 */
export function poolBalance(
  members: PoolMember[],
  totalAllowedSeconds: number
): PoolResult {
  const totalUsed = members.reduce((sum, m) => sum + m.usedSeconds, 0);
  const balance = computeBalance(totalAllowedSeconds, totalUsed);
  return {
    ...balance,
    contributions: members.map((m) => ({
      portCallId: m.portCallId,
      usedSeconds: m.usedSeconds,
    })),
  };
}

export type { Balance, BalanceOutcome };
