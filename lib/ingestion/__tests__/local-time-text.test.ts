import { describe, it, expect } from "vitest";
import { localToDisplay, displayToLocal } from "../local-time-text";

describe("SOF local time text", () => {
  it("shows stored times as on a SOF", () => {
    expect(localToDisplay("2026-06-23T00:01")).toBe("23/06/2026 00:01");
    expect(localToDisplay("")).toBe("");
  });
  it("reads typed times back", () => {
    expect(displayToLocal("23/06/2026 00:01")).toBe("2026-06-23T00:01");
    expect(displayToLocal("3/6/2026 0801")).toBe("2026-06-03T08:01");
    expect(displayToLocal("28-06-2026 11:15")).toBe("2026-06-28T11:15");
  });
  it("rejects impossible or malformed values", () => {
    expect(displayToLocal("31/06/2026 10:00")).toBeNull();
    expect(displayToLocal("23/06/2026 24:00")).toBeNull();
    expect(displayToLocal("2026-06-23T00:01")).toBeNull();
    expect(displayToLocal("yesterday")).toBeNull();
  });
  it("round-trips", () => {
    expect(displayToLocal(localToDisplay("2026-06-28T13:35"))).toBe("2026-06-28T13:35");
  });
});
