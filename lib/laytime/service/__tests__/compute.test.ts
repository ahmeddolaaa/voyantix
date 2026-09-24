import { describe, it, expect } from "vitest";
import {
  computePortCall,
  computeProvisionalStatus,
  type PortCallCalcData,
} from "../compute";
import { CalculationRefused } from "../../refuse";
import { settleBalance } from "../../settlement";
import { getLocalParts } from "../../timezone";
import { toLocalDateKey } from "../../calendar-classification";

const CAIRO = "Africa/Cairo";
const D = (iso: string) => new Date(iso);

// Window: NOR_ACCEPTED 06-12T05:00Z + 24h turn time = 06-13T05:00Z start,
// OPS_COMPLETED 06-15T05:00Z end. Span = 2 days.
const base = (over: Partial<PortCallCalcData> = {}): PortCallCalcData => ({
  timeZone: CAIRO,
  term: {
    allowanceBasis: "FIXED",
    allowance: "10",
    allowanceUnit: "days",
    allowanceRate: null,
    commencementRule: "NOR_ACCEPTED",
    commencementTimeRule: "AT_EVENT",
    turnTimeHours: "24",
    turnTimeTrigger: "NOR_ACCEPTED",
    onceOnDemurrage: false,
  },
  version: { excludedWeekdays: [], eiuApplies: true, weatherApplies: false },
  events: [
    { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
    { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-15T05:00:00Z") },
  ],
  stoppages: [],
  stoppageRules: [],
  holidayDates: [],
  workedLocalDates: [],
  actualQuantityMt: null,
  plannedQuantityMt: null,
  ...over,
});

describe("computePortCall — window + balance", () => {
  it("derives the window and balances a clean call", () => {
    const r = computePortCall(base());
    expect(r.window.start.toISOString()).toBe("2026-06-13T05:00:00.000Z");
    expect(r.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    expect(r.allowedSeconds).toBe(10 * 86400);
    expect(r.balance.usedSeconds).toBe(2 * 86400);
    expect(r.balance.outcome).toBe("SAVED");
  });
});

describe("computePortCall — event channel mapping", () => {
  it("ignores events with no engine semantic", () => {
    const r = computePortCall(
      base({
        events: [
          { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
          { semantic: null, occurredAt: D("2026-06-14T00:00:00Z") },
          { semantic: "PILOT_ABOARD", occurredAt: D("2026-06-14T01:00:00Z") },
          { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-15T05:00:00Z") },
        ],
      })
    );
    expect(r.balance.usedSeconds).toBe(2 * 86400);
  });

  it("routes WEATHER_* to the weather channel, not the window channel", () => {
    const r = computePortCall(
      base({
        events: [
          { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
          { semantic: "WEATHER_START", occurredAt: D("2026-06-14T00:00:00Z") },
          { semantic: "WEATHER_END", occurredAt: D("2026-06-14T06:00:00Z") },
          { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-15T05:00:00Z") },
        ],
      })
    );
    expect(r.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    expect(r.balance.usedSeconds).toBe(2 * 86400);
  });
});

describe("computePortCall — open stoppage closes to the window end", () => {
  it("an open AlwaysExcluded stoppage excludes to window end", () => {
    const r = computePortCall(
      base({
        stoppages: [
          { start: D("2026-06-14T00:00:00Z"), end: null, reasonId: "r1" },
        ],
        stoppageRules: [{ stoppageReasonId: "r1", countability: "AlwaysExcluded" }],
      })
    );
    // Counts only 06-13T05:00Z → 06-14T00:00Z = 19h.
    expect(r.balance.usedSeconds).toBe(19 * 3600);
  });
});

describe("computePortCall — EIU used-set (F24)", () => {
  it("counts an excluded day only when it was worked (eiuApplies=false)", () => {
    const startLocal = getLocalParts(D("2026-06-13T05:00:00Z"), CAIRO);
    const excludedWd = startLocal.weekday;
    const startDayKey = toLocalDateKey(startLocal.year, startLocal.month, startLocal.day);

    const worked = computePortCall(
      base({
        version: { excludedWeekdays: [excludedWd], eiuApplies: false, weatherApplies: false },
        workedLocalDates: [startDayKey],
      })
    );
    const idle = computePortCall(
      base({
        version: { excludedWeekdays: [excludedWd], eiuApplies: false, weatherApplies: false },
        workedLocalDates: [],
      })
    );
    expect(worked.balance.usedSeconds).toBeGreaterThan(idle.balance.usedSeconds);
  });
});

describe("computePortCall — refusals propagate", () => {
  it("refuses an unrecognised allowance unit", () => {
    try {
      computePortCall(base({ term: { ...base().term, allowanceUnit: "widgets" } }));
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("ALLOWANCE_UNIT_UNRECOGNISED");
    }
  });

  it("refuses when the window-ending event is missing", () => {
    try {
      computePortCall(
        base({
          events: [{ semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") }],
        })
      );
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("WINDOW_END_EVENT_MISSING");
    }
  });
});

describe("computePortCall — rate-based allowance", () => {
  // Real MY FELLAS loading: 3052.403 MT / 3000 MT-per-day = 1.017468 days.
  const rateTerm = {
    allowanceBasis: "RATE",
    allowance: "0",
    allowanceUnit: "days",
    allowanceRate: "3000",
    commencementRule: "NOR_ACCEPTED",
    commencementTimeRule: "AT_EVENT",
    turnTimeHours: null,
    turnTimeTrigger: null,
    onceOnDemurrage: false,
  };

  it("computes allowed = actual quantity / rate", () => {
    const r = computePortCall(
      base({ term: rateTerm, actualQuantityMt: "3052.403" })
    );
    // 3052.403 / 3000 * 86400 = 87909.2064 s (= 1d 00h 25m 09s, doc's 1.017468 d)
    expect(r.allowedSeconds).toBeCloseTo(87909.2064, 2);
  });

  it("refuses a rate-based term when no actual quantity is recorded", () => {
    expect(() =>
      computePortCall(base({ term: rateTerm, actualQuantityMt: null }))
    ).toThrow(/actual cargo quantity/i);
  });
});

describe("computeProvisionalStatus — running reference", () => {
  const rateTerm = {
    allowanceBasis: "RATE",
    allowance: "0",
    allowanceUnit: "days",
    allowanceRate: "3000",
    commencementRule: "NOR_ACCEPTED",
    commencementTimeRule: "AT_EVENT",
    turnTimeHours: null,
    turnTimeTrigger: null,
    onceOnDemurrage: false,
  };
  // In progress: NOR accepted, no OPS_COMPLETED yet.
  const events = [
    { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
  ];

  it("uses PLANNED quantity when no actual, flagged provisional", () => {
    const s = computeProvisionalStatus(
      base({ term: rateTerm, events, plannedQuantityMt: "3000", actualQuantityMt: null }),
      D("2026-06-13T05:00:00Z")
    );
    expect(s.quantityIsActual).toBe(false);
    expect(s.allowedSeconds).toBe(86400); // 3000/3000 * 86400 = 1 day
    expect(s.usedSeconds).toBe(86400); // 24h elapsed, nothing excluded
    expect(s.onDemurrage).toBe(false);
  });

  it("flags on-demurrage once used exceeds allowed", () => {
    const s = computeProvisionalStatus(
      base({ term: rateTerm, events, plannedQuantityMt: "3000", actualQuantityMt: null }),
      D("2026-06-14T05:00:00Z")
    );
    expect(s.usedSeconds).toBe(2 * 86400);
    expect(s.remainingSeconds).toBeLessThan(0);
    expect(s.onDemurrage).toBe(true);
  });

  it("prefers ACTUAL quantity when it exists", () => {
    const s = computeProvisionalStatus(
      base({ term: rateTerm, events, plannedQuantityMt: "3000", actualQuantityMt: "1500" }),
      D("2026-06-13T05:00:00Z")
    );
    expect(s.quantityIsActual).toBe(true);
    expect(s.allowedSeconds).toBe(43200); // 1500/3000 * 86400 = 0.5 day
    expect(s.onDemurrage).toBe(true); // 24h used > 12h allowed
  });
});

describe("computePortCall — commencement time rule from the term", () => {
  // MV YUFIX: NOR tendered Mon 06/07/26 08:00 → laytime starts 14:00 same day.
  const events = [
    { semantic: "NOR_TENDERED", occurredAt: D("2026-07-06T05:00:00Z") }, // 08:00 Cairo
    { semantic: "OPS_COMPLETED", occurredAt: D("2026-07-07T21:00:00Z") },
  ];
  const term = (commencementTimeRule: string) => ({
    ...base().term,
    commencementRule: "NOR_TENDERED",
    commencementTimeRule,
    turnTimeHours: null,
    turnTimeTrigger: null,
  });

  it("MORNING_NOR_1400 starts counting at 14:00 local", () => {
    const r = computePortCall(base({ term: term("MORNING_NOR_1400"), events }));
    expect(r.window.start.toISOString()).toBe("2026-07-06T11:00:00.000Z"); // 14:00 Cairo
  });

  it("AT_EVENT starts at the NOR itself", () => {
    const r = computePortCall(base({ term: term("AT_EVENT"), events }));
    expect(r.window.start.toISOString()).toBe("2026-07-06T05:00:00.000Z");
  });

  it("MORNING_NOR_1400 after 12:00 starts 08:00 next working day from the rule set's calendar", () => {
    // NOR Thu 02/07/26 15:30 Cairo; Friday excluded, Sat 04/07 a holiday → Sun 05/07 08:00.
    const afterNoon = [
      { semantic: "NOR_TENDERED", occurredAt: D("2026-07-02T12:30:00Z") }, // 15:30 Cairo
      { semantic: "OPS_COMPLETED", occurredAt: D("2026-07-07T21:00:00Z") },
    ];
    const r = computePortCall(
      base({
        term: term("MORNING_NOR_1400"),
        events: afterNoon,
        version: { excludedWeekdays: [5], eiuApplies: true, weatherApplies: false },
        holidayDates: ["2026-07-04"],
      })
    );
    expect(r.window.start.toISOString()).toBe("2026-07-05T05:00:00.000Z"); // Sun 08:00 Cairo
  });

  it("provisional status uses the same after-noon commencement", () => {
    const afterNoon = [
      { semantic: "NOR_TENDERED", occurredAt: D("2026-07-02T12:30:00Z") },
    ];
    const s = computeProvisionalStatus(
      base({
        term: term("MORNING_NOR_1400"),
        events: afterNoon,
        version: { excludedWeekdays: [5], eiuApplies: true, weatherApplies: false },
        holidayDates: [],
      }),
      D("2026-07-04T09:00:00Z") // Sat 12:00 Cairo
    );
    expect(s.window.start.toISOString()).toBe("2026-07-04T05:00:00.000Z"); // Sat 08:00 Cairo
    expect(s.usedSeconds).toBe(4 * 3600);
  });

  it("refuses an unrecognised rule rather than guessing", () => {
    expect(() => computePortCall(base({ term: term("SOMETIMES"), events }))).toThrow(
      CalculationRefused
    );
  });
});

describe("computeProvisionalStatus — stops at operations completed", () => {
  // Reproduces the production report: ops completed 28/06 but the port call was
  // still ACTIVE, and the meter kept counting to "now" (91 days over).
  const events = [
    { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
    { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-15T05:00:00Z") },
  ];

  it("caps the window at OPS_COMPLETED when now is later", () => {
    const s = computeProvisionalStatus(base({ events }), D("2026-09-24T05:00:00Z"));
    expect(s.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    expect(s.usedSeconds).toBe(2 * 86400); // same as the final calculation
    expect(s.operationsCompletedAt?.toISOString()).toBe("2026-06-15T05:00:00.000Z");
  });

  it("agrees with computePortCall once operations are complete", () => {
    const final = computePortCall(base({ events }));
    const s = computeProvisionalStatus(base({ events }), D("2026-09-24T05:00:00Z"));
    expect(s.usedSeconds).toBe(final.balance.usedSeconds);
  });

  it("still runs to now while operations are in progress", () => {
    const running = [events[0]];
    const s = computeProvisionalStatus(base({ events: running }), D("2026-06-14T05:00:00Z"));
    expect(s.window.end.toISOString()).toBe("2026-06-14T05:00:00.000Z");
    expect(s.operationsCompletedAt).toBeNull();
  });
});

describe("computePortCall — laytime end event (term default + port-call override)", () => {
  // NOR accepted 06-12T05:00Z + 24h turn time → counting from 06-13T05:00Z.
  const events = [
    { semantic: "NOR_ACCEPTED", occurredAt: D("2026-06-12T05:00:00Z") },
    { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-15T05:00:00Z") },
    { semantic: "LASHING_COMPLETED", occurredAt: D("2026-06-15T06:00:00Z") },
    { semantic: "DOCUMENTS_ON_BOARD", occurredAt: D("2026-06-15T15:00:00Z") },
  ];

  it("defaults to OPS_COMPLETED (prior behaviour)", () => {
    const r = computePortCall(base({ events }));
    expect(r.window.end.toISOString()).toBe("2026-06-15T05:00:00.000Z");
  });

  it("term default LASHING_COMPLETED ends at lashing", () => {
    const r = computePortCall(base({ events, term: { ...base().term, laytimeEndEvent: "LASHING_COMPLETED" } }));
    expect(r.window.end.toISOString()).toBe("2026-06-15T06:00:00.000Z");
    expect(r.balance.usedSeconds).toBe(2 * 86400 + 3600);
  });

  it("port-call override DOCUMENTS_ON_BOARD beats the term default", () => {
    const r = computePortCall(
      base({
        events,
        term: { ...base().term, laytimeEndEvent: "LASHING_COMPLETED" },
        laytimeEndOverride: "DOCUMENTS_ON_BOARD",
      })
    );
    expect(r.window.end.toISOString()).toBe("2026-06-15T15:00:00.000Z");
  });

  it("refuses when the chosen end event is not recorded — no fallback", () => {
    const noLashing = events.filter((e) => e.semantic !== "LASHING_COMPLETED");
    try {
      computePortCall(base({ events: noLashing, term: { ...base().term, laytimeEndEvent: "LASHING_COMPLETED" } }));
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("WINDOW_END_EVENT_MISSING");
    }
  });

  it("refuses an unknown end event", () => {
    expect(() => computePortCall(base({ events, laytimeEndOverride: "SAILED" }))).toThrow(CalculationRefused);
  });

  it("provisional status refuses (not 91 days) when ops completed but the chosen end is not recorded", () => {
    const noDocs = events.filter((e) => e.semantic !== "DOCUMENTS_ON_BOARD");
    try {
      computeProvisionalStatus(base({ events: noDocs, laytimeEndOverride: "DOCUMENTS_ON_BOARD" }), D("2026-09-24T05:00:00Z"));
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationRefused);
      expect((e as CalculationRefused).code).toBe("LAYTIME_END_EVENT_NOT_RECORDED");
      expect((e as Error).message).toContain("Documents on board");
    }
  });

  it("provisional status still runs to now while operations are in progress", () => {
    const running = events.filter((e) => e.semantic === "NOR_ACCEPTED");
    const s = computeProvisionalStatus(base({ events: running, laytimeEndOverride: "DOCUMENTS_ON_BOARD" }), D("2026-06-14T05:00:00Z"));
    expect(s.window.end.toISOString()).toBe("2026-06-14T05:00:00.000Z");
  });

  it("provisional status stops at the configured end event", () => {
    const s = computeProvisionalStatus(
      base({ events, laytimeEndOverride: "DOCUMENTS_ON_BOARD" }),
      D("2026-09-24T05:00:00Z")
    );
    expect(s.window.end.toISOString()).toBe("2026-06-15T15:00:00.000Z");
  });
});

describe("GOLDEN — MY FELLAS loading through the app path (documents on board)", () => {
  // Real calculation sheet: laytime Tue 23/06 14:00 → documents on board Sun 28/06
  // 11:15; used 4d 21h 15m; allowed 1.017468 d; on demurrage 3.867949 d; $13,537.82.
  const data = base({
    term: {
      allowanceBasis: "RATE", allowance: "0", allowanceUnit: "days", allowanceRate: "3000",
      commencementRule: "NOR_TENDERED", commencementTimeRule: "MORNING_NOR_1400",
      turnTimeHours: null, turnTimeTrigger: null, onceOnDemurrage: true,
      laytimeEndEvent: "LASHING_COMPLETED",
    },
    laytimeEndOverride: "DOCUMENTS_ON_BOARD",
    version: { excludedWeekdays: [5, 6], eiuApplies: true, weatherApplies: false },
    events: [
      { semantic: "NOR_TENDERED", occurredAt: D("2026-06-22T21:01:00Z") }, // 23/06 00:01
      { semantic: "OPS_COMPLETED", occurredAt: D("2026-06-27T21:05:00Z") }, // 28/06 00:05
      { semantic: "LASHING_COMPLETED", occurredAt: D("2026-06-27T21:10:00Z") }, // 00:10
      { semantic: "DOCUMENTS_ON_BOARD", occurredAt: D("2026-06-28T08:15:00Z") }, // 11:15
    ],
    actualQuantityMt: "3052.403",
  });

  it("used 4d 21h 15m and 3.867949 days on demurrage", () => {
    const r = computePortCall(data);
    expect(r.window.start.toISOString()).toBe("2026-06-23T11:00:00.000Z");
    expect(r.balance.usedSeconds).toBe(4 * 86400 + 21 * 3600 + 15 * 60);
    expect((r.balance.usedSeconds - r.allowedSeconds) / 86400).toBeCloseTo(3.867949, 6);
  });

  it("demurrage $13,537.82 at $3,500/day with EXACT day rounding (the sheet's convention)", () => {
    const r = computePortCall(data);
    const s = settleBalance({
      outcome: r.balance.outcome,
      balanceSeconds: r.allowedSeconds - r.balance.usedSeconds,
      demurrageRate: 3500, despatchRate: null, despatchBasis: null, dayPrecision: "EXACT",
    });
    if (s.kind !== "demurrage") throw new Error("expected demurrage");
    expect(s.amount).toBe(13537.82);
  });
});
