import { describe, it, expect } from "vitest";
import { poolBalance, type PoolMember } from "../pool";

const DAY = 86400;

const members: PoolMember[] = [
  { portCallId: "pc-1", usedSeconds: 3 * DAY },
  { portCallId: "pc-2", usedSeconds: 4 * DAY },
];

describe("poolBalance", () => {
  it("balances the members' total used time against the shared allowance", () => {
    const r = poolBalance(members, 10 * DAY);
    expect(r.usedSeconds).toBe(7 * DAY);
    expect(r.allowedSeconds).toBe(10 * DAY);
    expect(r.balanceSeconds).toBe(3 * DAY);
    expect(r.outcome).toBe("SAVED");
  });

  it("reports exceeded when the pool overruns", () => {
    const r = poolBalance(members, 5 * DAY);
    expect(r.balanceSeconds).toBe(-2 * DAY);
    expect(r.outcome).toBe("EXCEEDED");
  });

  it("keeps each member's contribution visible", () => {
    const r = poolBalance(members, 10 * DAY);
    expect(r.contributions).toEqual([
      { portCallId: "pc-1", usedSeconds: 3 * DAY },
      { portCallId: "pc-2", usedSeconds: 4 * DAY },
    ]);
  });

  it("the pooled balance is independent of member order", () => {
    const a = poolBalance(members, 10 * DAY);
    const b = poolBalance([...members].reverse(), 10 * DAY);
    expect(a.balanceSeconds).toBe(b.balanceSeconds);
  });

  it("an empty pool uses none of the allowance", () => {
    const r = poolBalance([], 10 * DAY);
    expect(r.usedSeconds).toBe(0);
    expect(r.balanceSeconds).toBe(10 * DAY);
  });
});
