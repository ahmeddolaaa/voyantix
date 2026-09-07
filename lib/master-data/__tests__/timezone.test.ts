import { describe, it, expect } from "vitest";
import {
  resolveTimezone,
  isValidTimezone,
  requireTimezone,
  timezoneSuggestions,
  InvalidTimezoneError,
} from "../timezone";

describe("resolveTimezone — required cases", () => {
  it("accepts UTC even though the runtime list omits it", () => {
    expect(resolveTimezone("UTC")).toBe("UTC");
  });

  it("accepts Asia/Kolkata even though the runtime list carries Asia/Calcutta", () => {
    const resolved = resolveTimezone("Asia/Kolkata");
    expect(resolved).not.toBeNull();
    // The runtime may canonicalize to either spelling depending on ICU
    // version; what matters is that it is accepted and stable.
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(resolved);
  });

  it("accepts Africa/Cairo", () => {
    expect(resolveTimezone("Africa/Cairo")).toBe("Africa/Cairo");
  });

  it("accepts Europe/Istanbul", () => {
    expect(resolveTimezone("Europe/Istanbul")).toBe("Europe/Istanbul");
  });

  it("accepts Etc/UTC", () => {
    expect(resolveTimezone("Etc/UTC")).not.toBeNull();
  });

  it("canonicalizes case variants rather than storing raw casing", () => {
    expect(resolveTimezone("africa/cairo")).toBe("Africa/Cairo");
    expect(resolveTimezone("ASIA/DUBAI")).toBe("Asia/Dubai");
    expect(resolveTimezone("eUrOpE/iStAnBuL")).toBe("Europe/Istanbul");
  });

  it("trims surrounding whitespace", () => {
    expect(resolveTimezone("  Africa/Cairo  ")).toBe("Africa/Cairo");
    expect(resolveTimezone("\tAsia/Dubai\n")).toBe("Asia/Dubai");
    expect(resolveTimezone("  utc ")).toBe("UTC");
  });

  it("rejects an invalid timezone", () => {
    expect(resolveTimezone("Not/AZone")).toBeNull();
    expect(resolveTimezone("Mars/Olympus_Mons")).toBeNull();
    expect(resolveTimezone("Alexandria")).toBeNull();
  });

  it("rejects empty and whitespace-only input", () => {
    expect(resolveTimezone("")).toBeNull();
    expect(resolveTimezone("   ")).toBeNull();
  });

  it("rejects a country name", () => {
    expect(resolveTimezone("Egypt Standard Time")).toBeNull();
  });
});

describe("UTC offsets must never be stored", () => {
  it("rejects offsets in every shape the runtime tolerates", () => {
    for (const v of ["+02:00", "-05:30", "+0200", "-0530", "+2", "-11"]) {
      expect(resolveTimezone(v)).toBeNull();
    }
  });

  it("still accepts region identifiers that merely look offset-adjacent", () => {
    expect(resolveTimezone("Etc/GMT+2")).not.toBeNull();
  });
});

describe("isValidTimezone", () => {
  it("mirrors resolveTimezone", () => {
    expect(isValidTimezone("Africa/Cairo")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
  });
});

describe("requireTimezone", () => {
  it("returns the canonical form", () => {
    expect(requireTimezone("  africa/cairo ")).toBe("Africa/Cairo");
  });

  it("throws InvalidTimezoneError on junk", () => {
    expect(() => requireTimezone("Not/AZone")).toThrow(InvalidTimezoneError);
  });
});

describe("timezoneSuggestions — convenience only", () => {
  it("includes UTC, which the raw runtime list omits", () => {
    expect(timezoneSuggestions()).toContain("UTC");
  });

  it("returns a large, sorted, deduplicated list", () => {
    const list = timezoneSuggestions();
    expect(list.length).toBeGreaterThan(300);
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort((a, b) => a.localeCompare(b))).toEqual(list);
  });

  it("every suggestion is itself resolvable", () => {
    const unresolvable = timezoneSuggestions().filter(
      (tz) => resolveTimezone(tz) === null
    );
    expect(unresolvable).toEqual([]);
  });
});
