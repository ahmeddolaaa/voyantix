import { describe, it, expect } from "vitest";
import { normalizeExtraction, responseText, buildPrompt, SOF_JSON_SCHEMA } from "../gemini";

describe("normalizeExtraction", () => {
  const at = "2026-09-24T12:00:00.000Z";

  it("keeps valid rows, sorts them and records provenance", () => {
    const x = normalizeExtraction(
      {
        document: { kind: "SOF", vesselName: " MV AURORA STAR ", operation: "LOAD", cargoQuantityMt: 3052.403, charterPartyDate: "2026-06-11", localTimeZone: "Africa/Cairo" },
        events: [
          { type: "BERTHED", occurredLocal: "2026-06-25T08:00", sourceSnippet: "All fast 0800", confidence: 0.9 },
          { type: "NOR_TENDERED", occurredLocal: "2026-06-23 00:01:00", sourceSnippet: "NOR tendered 0001", confidence: 1.4 },
        ],
        stoppages: [{ startLocal: "2026-06-26T12:00", endLocal: "2026-06-26T13:00", reasonText: "Friday prayer", reasonCategory: "RELIGIOUS", sourceSnippet: "1200-1300 prayer", confidence: 0.8 }],
        rawRemarks: ["Fridays and Saturdays are official weekends", ""],
        conflicts: [],
      },
      "gemini-test",
      at
    );
    expect(x.document.vesselName).toBe("MV AURORA STAR");
    expect(x.document.operation).toBe("LOAD");
    expect(x.events.map((e) => [e.type, e.occurredLocal])).toEqual([
      ["NOR_TENDERED", "2026-06-23T00:01"],
      ["BERTHED", "2026-06-25T08:00"],
    ]);
    expect(x.events[0].confidence).toBe(1); // clamped
    expect(x.stoppages[0].reasonCategory).toBe("RELIGIOUS");
    expect(x.rawRemarks).toEqual(["Fridays and Saturdays are official weekends"]);
    expect(x.extractionModel).toBe("gemini-test");
    expect(x.extractedAt).toBe(at);
  });

  it("drops what cannot be read and says so in conflicts", () => {
    const x = normalizeExtraction(
      {
        document: { kind: "WHATEVER" },
        events: [
          { type: "PILOT_ON_BOARD", occurredLocal: "2026-06-23T01:00", sourceSnippet: "", confidence: 1 },
          { type: "BERTHED", occurredLocal: "25th June morning", sourceSnippet: "", confidence: 1 },
        ],
        stoppages: [
          { startLocal: "2026-06-26T13:00", endLocal: "2026-06-26T12:00", reasonText: "Rain", reasonCategory: "WEATHER", sourceSnippet: "", confidence: 1 },
          { startLocal: "2026-06-26T14:00", endLocal: null, reasonText: "Crane breakdown", reasonCategory: "MYSTERY", sourceSnippet: "", confidence: 1 },
        ],
      },
      "m",
      at
    );
    expect(x.document.kind).toBe("OTHER");
    expect(x.events).toHaveLength(0);
    expect(x.stoppages).toEqual([
      expect.objectContaining({ startLocal: "2026-06-26T14:00", endLocal: null, reasonCategory: "OTHER" }),
    ]);
    expect(x.conflicts).toHaveLength(3);
  });

  it("survives a reply that is not the expected shape", () => {
    const x = normalizeExtraction("nonsense", "m", at);
    expect(x.events).toEqual([]);
    expect(x.stoppages).toEqual([]);
    expect(x.document.kind).toBe("OTHER");
  });
});

describe("gemini request helpers", () => {
  it("reads the text of the first candidate", () => {
    expect(responseText({ candidates: [{ content: { parts: [{ text: '{"a":' }, { text: "1}" }] } }] })).toBe('{"a":1}');
    expect(responseText({ candidates: [] })).toBeNull();
  });

  it("carries the port hints into the prompt and the full event taxonomy into the schema", () => {
    const p = buildPrompt({ operation: "DISCHARGE", timeZone: "Europe/Istanbul" });
    expect(p).toContain("discharging operation");
    expect(p).toContain("Europe/Istanbul");
    expect(SOF_JSON_SCHEMA.properties.events.items.properties.type.enum).toContain("DOCUMENTS_SIGNED");
  });
});
