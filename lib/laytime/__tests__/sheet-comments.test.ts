import { describe, it, expect } from "vitest";
import { sheetComment } from "../sheet-comments";

describe("sheetComment — laytime sheet wording", () => {
  it("first counted interval", () => {
    expect(sheetComment({ reasons: [], treatment: "COUNTED", countedFraction: 1, isFirst: true }))
      .toBe("Time to count – laytime started");
  });
  it("plain counted", () => {
    expect(sheetComment({ reasons: [], treatment: "COUNTED", countedFraction: 1 })).toBe("Time to count");
  });
  it("on demurrage", () => {
    expect(sheetComment({ reasons: ["ON_DEMURRAGE"], treatment: "COUNTED", countedFraction: 1 }))
      .toBe("Time to count – vessel is on demurrage");
  });
  it("excepted day counted on demurrage", () => {
    expect(sheetComment({ reasons: ["EXCLUDED_WEEKDAY", "EIU_KEPT_EXCLUDED", "ON_DEMURRAGE"], treatment: "COUNTED", countedFraction: 1 }))
      .toBe("Time to count – excepted day, vessel is on demurrage");
  });
  it("stoppage not counted, named", () => {
    expect(sheetComment({ reasons: ["STOPPAGE_EXCLUDED"], treatment: "EXCLUDED", countedFraction: 0, stoppageNames: ["Labour break"] }))
      .toBe("Not to count – Labour break");
  });
  it("excepted day not counted", () => {
    expect(sheetComment({ reasons: ["EXCLUDED_WEEKDAY", "EIU_KEPT_EXCLUDED"], treatment: "EXCLUDED", countedFraction: 0 }))
      .toBe("Not to count – Excepted day");
  });
  it("stoppage still excepted on demurrage", () => {
    expect(sheetComment({ reasons: ["STOPPAGE_EXCLUDED", "ON_DEMURRAGE", "EXCEPTED_ON_DEMURRAGE"], treatment: "EXCLUDED", countedFraction: 0, stoppageNames: ["Breakdown"] }))
      .toBe("Not to count – Breakdown (still excepted on demurrage)");
  });
});
