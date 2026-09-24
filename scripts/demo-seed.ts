/**
 * DEMO SEED — wipes EVERY row in the database and builds one fictional
 * company ("Bulk Trading") with master data, contracts, three vessels working
 * right now and six finished voyages spread over the last six months. All
 * names are invented. Times are relative to the moment the script runs, so
 * the "working now" vessels are live whenever it is run.
 *
 *   DATABASE_URL=...  DEMO_PASSWORD=...  WIPE_CONFIRM=wipe-everything \
 *     npx tsx scripts/demo-seed.ts
 *
 * Laytime, statements and finalization go through the real server actions
 * (engine + persistence), run under a script session for the demo admin —
 * nothing here computes a laytime figure itself.
 *
 * IRREVERSIBLE on the target database. Take a backup first
 * (scripts/db-backup.ts).
 */

import { db, pool } from "@/db/client";
import {
  organizations,
  users,
  memberships,
  companyConfigurations,
  referenceSequences,
  ports,
  facilities,
  cargoes,
  vessels,
  stoppageReasons,
  operationalEventTypes,
  laytimeRuleSets,
  laytimeRuleSetVersions,
  contracts,
  contractLaytimeTerms,
  contractStoppageRules,
  voyages,
  voyagePortCalls,
  cargoPlans,
  operationalEvents,
  stoppages,
  shiftPerformances,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession, runWithSession } from "@/lib/auth/session";
import { seedProtectedEventTypes } from "@/lib/master-data/seed-event-types";
import { getLocalParts, instantFromLocal } from "@/lib/laytime/timezone";
import { recalculatePortCall } from "@/lib/actions/laytime-calculations";
import { buildStatementDraft, finalizeStatement } from "@/lib/actions/laytime-statements";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date();

// ---------------------------------------------------------------- helpers
/** Local wall-clock `hh:mm` on the local day `daysAgo` days before today, in `tz`. */
function at(tz: string, daysAgo: number, hhmm: string): Date {
  const today = getLocalParts(NOW, tz);
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day) - daysAgo * DAY);
  const [h, m] = hhmm.split(":").map(Number);
  return instantFromLocal(
    { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), hour: h, minute: m },
    tz
  );
}
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const localDate = (d: Date, tz: string) => {
  const p = getLocalParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

type Sem =
  | "ARRIVED"
  | "NOR_TENDERED"
  | "NOR_ACCEPTED"
  | "BERTHED"
  | "OPS_COMMENCED"
  | "OPS_COMPLETED"
  | "LASHING_COMPLETED"
  | "DOCUMENTS_ON_BOARD"
  | "DEPARTED";

type CallSpec = {
  ref: string;
  vessel: string;
  termKey: string;
  fn: "LOAD" | "DISCHARGE";
  port: string;
  facility: string;
  cargo: { name: string; planned: number }[];
  /** Tonnes handled so far (working) or in total (finished). */
  handled: number;
  finished: boolean;
  events: [Sem, Date][];
  stops: { reason: string; start: Date; end: Date | null }[];
  cranes: string[];
  statement?: "draft" | "final";
};

async function main() {
  const url = process.env.DATABASE_URL;
  const password = process.env.DEMO_PASSWORD;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (process.env.WIPE_CONFIRM !== "wipe-everything") {
    throw new Error("Refusing to run: set WIPE_CONFIRM=wipe-everything to confirm wiping ALL data.");
  }
  if (!password || password.length < 10) {
    throw new Error("Set DEMO_PASSWORD (10+ characters) for the demo login.");
  }
  console.log(`Target database: ${new URL(url).host}`);

  // ---------------------------------------------------------------- wipe
  const tables = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`
  );
  await pool.query(
    `truncate ${tables.rows.map((t) => `"public"."${t.table_name}"`).join(", ")} restart identity cascade`
  );
  console.log(`Wiped ${tables.rows.length} tables.`);

  // ------------------------------------------------------------- company
  const [org] = await db.insert(organizations).values({ name: "Bulk Trading", slug: "bulk-trading" }).returning();
  const O = org.id;
  await db.insert(companyConfigurations).values({
    organizationId: O,
    defaultTimezone: "Africa/Cairo",
    voyageReferencePattern: "VOY-{YY}{SEQ:4}",
  });
  const year = getLocalParts(NOW, "Africa/Cairo").year;
  await db.insert(referenceSequences).values({ organizationId: O, scope: `voyage:${year}`, nextValue: 20 });

  const hash = await hashPassword(password);
  const [ahmed] = await db
    .insert(users)
    .values({ email: "ahmed@bulk-trading.com", passwordHash: hash, name: "Ahmed Adel" })
    .returning();
  const [karim] = await db
    .insert(users)
    .values({ email: "karim@bulk-trading.com", passwordHash: hash, name: "Karim Samir" })
    .returning();
  await db.insert(memberships).values([
    { userId: ahmed.id, organizationId: O, role: "admin" },
    { userId: karim.id, organizationId: O, role: "operations" },
  ]);
  await seedProtectedEventTypes(O);
  const [arrivedType] = await db
    .insert(operationalEventTypes)
    .values({ organizationId: O, code: "arrived", label: "Vessel arrived", displayOrder: 5 })
    .returning();
  const typeRows = await db.select().from(operationalEventTypes).where(eq(operationalEventTypes.organizationId, O));
  const typeOf = (s: Sem) =>
    s === "ARRIVED" ? arrivedType.id : typeRows.find((t) => t.systemSemantic === s)!.id;

  // --------------------------------------------------------- master data
  const portDefs = [
    { name: "Alexandria", country: "EG", unlocode: "EGALY", tz: "Africa/Cairo", fac: ["Quay 85", "Quay 86"] },
    { name: "Damietta", country: "EG", unlocode: "EGDAM", tz: "Africa/Cairo", fac: ["Berth 7"] },
    { name: "Jebel Ali", country: "AE", unlocode: "AEJEA", tz: "Asia/Dubai", fac: ["Berth 12"] },
    { name: "Gemlik", country: "TR", unlocode: "TRGEM", tz: "Europe/Istanbul", fac: ["Berth 2"] },
    { name: "Constanta", country: "RO", unlocode: "ROCND", tz: "Europe/Bucharest", fac: ["Berth 80"] },
  ];
  const portId: Record<string, string> = {};
  const portTz: Record<string, string> = {};
  const facId: Record<string, string> = {};
  for (const p of portDefs) {
    const [row] = await db
      .insert(ports)
      .values({ organizationId: O, name: p.name, country: p.country, unlocode: p.unlocode, defaultTimezone: p.tz })
      .returning();
    portId[p.name] = row.id;
    portTz[p.name] = p.tz;
    for (const f of p.fac) {
      const [fr] = await db.insert(facilities).values({ organizationId: O, portId: row.id, name: f }).returning();
      facId[`${p.name}/${f}`] = fr.id;
    }
  }

  const cargoNames = ["Rebar B500B", "Wire rod SAE1008", "HRC coils", "Billets 5SP"];
  const cargoId: Record<string, string> = {};
  for (const c of cargoNames) {
    const [row] = await db.insert(cargoes).values({ organizationId: O, name: c }).returning();
    cargoId[c] = row.id;
  }

  const vesselNames = [
    "MV CAPE HALDEN", "MV SEA LANTERN", "MV NORTHERN GRACE", "MV AURORA STAR",
    "MV BLUE MERIDIAN", "MV IRON WREN", "MV SILVER TERN", "MV CORAL BAY", "MV ORION PEAK", "MV ATLAS DAWN",
  ];
  for (const v of vesselNames) await db.insert(vessels).values({ organizationId: O, name: v });

  const reasonId: Record<string, string> = {};
  for (const [name, weather] of [
    ["Rain", true],
    ["Friday prayer", false],
    ["Crane breakdown", false],
    ["Shifting", false],
    ["Awaiting cargo", false],
  ] as const) {
    const [row] = await db
      .insert(stoppageReasons)
      .values({ organizationId: O, name, isWeatherRelated: weather })
      .returning();
    reasonId[name] = row.id;
  }

  // ---------------------------------------------------------- rule sets
  async function ruleSet(name: string, excludedWeekdays: number[], eiu: boolean) {
    const [rs] = await db.insert(laytimeRuleSets).values({ organizationId: O, name }).returning();
    const [v] = await db
      .insert(laytimeRuleSetVersions)
      .values({ organizationId: O, ruleSetId: rs.id, versionNumber: 1, excludedWeekdays, excludeHolidays: false, eiuApplies: eiu, weatherApplies: false })
      .returning();
    return v.id;
  }
  const rsFshex = await ruleSet("Egypt FSHEX EIU", [5, 6], true);
  const rsShinc = await ruleSet("SHINC — all days count", [], false);

  // ---------------------------------------------------------- contracts
  async function contract(reference: string, counterparty: string, daysAgo: number) {
    const [c] = await db
      .insert(contracts)
      .values({ organizationId: O, reference, counterparty, contractDate: localDate(new Date(NOW.getTime() - daysAgo * DAY), "Africa/Cairo") })
      .returning();
    return c.id;
  }
  const cSolen = await contract("CP-2026-014", "Solen Shipping", 200);
  const cKestrel = await contract("CP-2026-021", "Kestrel Bulk Carriers", 190);
  const cMarlowe = await contract("CP-2026-027", "Marlowe Maritime", 185);

  type TermDef = {
    contract: string;
    fn: "LOAD" | "DISCHARGE";
    port: string;
    rate: number;
    dem: number;
    des: number;
    rs: string;
    commencementRule: string;
    timeRule: "AT_EVENT" | "MORNING_NOR_1400";
    turnTime: number | null;
    oodaod: boolean;
    end: "OPS_COMPLETED" | "LASHING_COMPLETED" | "DOCUMENTS_ON_BOARD";
    clause: string;
    stops: Record<string, "AlwaysExcluded" | "NeverExcluded">;
  };
  const termDefs: Record<string, TermDef> = {
    alexLoad: {
      contract: cSolen, fn: "LOAD", port: "Alexandria", rate: 3000, dem: 12000, des: 6000, rs: rsFshex,
      commencementRule: "NOR_TENDERED", timeRule: "MORNING_NOR_1400", turnTime: null, oodaod: true,
      end: "LASHING_COMPLETED", clause: "3000 MT PWWD FSHEX EIU",
      stops: { Rain: "AlwaysExcluded", "Friday prayer": "AlwaysExcluded", "Crane breakdown": "AlwaysExcluded", Shifting: "AlwaysExcluded" },
    },
    damLoad: {
      contract: cKestrel, fn: "LOAD", port: "Damietta", rate: 4000, dem: 14000, des: 7000, rs: rsShinc,
      commencementRule: "NOR_ACCEPTED", timeRule: "AT_EVENT", turnTime: 6, oodaod: false,
      end: "OPS_COMPLETED", clause: "4000 MT PWWD SHINC, 6 hours turn time",
      stops: { Rain: "AlwaysExcluded", "Crane breakdown": "AlwaysExcluded" },
    },
    jeaDisch: {
      contract: cMarlowe, fn: "DISCHARGE", port: "Jebel Ali", rate: 5000, dem: 15000, des: 7500, rs: rsShinc,
      commencementRule: "NOR_ACCEPTED", timeRule: "AT_EVENT", turnTime: 6, oodaod: true,
      end: "OPS_COMPLETED", clause: "5000 MT PWWD SHINC, 6 hours turn time",
      stops: { Rain: "AlwaysExcluded", Shifting: "AlwaysExcluded" },
    },
    gemDisch: {
      contract: cSolen, fn: "DISCHARGE", port: "Gemlik", rate: 4500, dem: 13000, des: 6500, rs: rsShinc,
      commencementRule: "NOR_ACCEPTED", timeRule: "AT_EVENT", turnTime: 6, oodaod: true,
      end: "OPS_COMPLETED", clause: "4500 MT PWWD SHINC, 6 hours turn time",
      stops: { Rain: "AlwaysExcluded" },
    },
  };
  const termId: Record<string, string> = {};
  for (const [key, t] of Object.entries(termDefs)) {
    const [row] = await db
      .insert(contractLaytimeTerms)
      .values({
        organizationId: O,
        contractId: t.contract,
        function: t.fn,
        portId: portId[t.port],
        allowanceBasis: "RATE",
        allowance: "0",
        allowanceUnit: "days",
        allowanceRate: String(t.rate),
        demurrageRate: String(t.dem),
        despatchRate: String(t.des),
        despatchBasis: "WTS",
        turnTimeHours: t.turnTime === null ? null : String(t.turnTime),
        turnTimeTrigger: t.turnTime === null ? null : t.commencementRule,
        commencementRule: t.commencementRule,
        commencementTimeRule: t.timeRule,
        onceOnDemurrage: t.oodaod,
        laytimeEndEvent: t.end,
        laytimeClauseText: t.clause,
        ruleSetVersionId: t.rs,
      })
      .returning();
    termId[key] = row.id;
    for (const [reason, countability] of Object.entries(t.stops)) {
      await db.insert(contractStoppageRules).values({ organizationId: O, termId: row.id, stoppageReasonId: reasonId[reason], countability });
    }
  }

  // ------------------------------------------------------------ voyages
  const A = "Africa/Cairo";
  const J = "Asia/Dubai";
  const G = "Europe/Istanbul";
  const calls: CallSpec[] = [
    // ---- working now
    {
      ref: "VOY-260019", vessel: "MV CAPE HALDEN", termKey: "alexLoad", fn: "LOAD", port: "Alexandria", facility: "Quay 85",
      cargo: [{ name: "Rebar B500B", planned: 8000 }, { name: "Wire rod SAE1008", planned: 4500 }],
      handled: 6420, finished: false, cranes: ["Crane 1", "Crane 2", "Crane 3"],
      events: [["ARRIVED", ago(60)], ["NOR_TENDERED", ago(56)], ["BERTHED", ago(49)], ["OPS_COMMENCED", ago(46)]],
      stops: [
        { reason: "Rain", start: ago(30), end: ago(27.5) },
        { reason: "Crane breakdown", start: ago(6), end: ago(4.8) },
      ],
    },
    {
      ref: "VOY-260018", vessel: "MV SEA LANTERN", termKey: "damLoad", fn: "LOAD", port: "Damietta", facility: "Berth 7",
      cargo: [{ name: "Billets 5SP", planned: 18000 }],
      handled: 12600, finished: false, cranes: ["Crane A", "Crane B"],
      events: [["ARRIVED", ago(90)], ["NOR_TENDERED", ago(86)], ["NOR_ACCEPTED", ago(85)], ["BERTHED", ago(80)], ["OPS_COMMENCED", ago(78)]],
      stops: [{ reason: "Rain", start: ago(40), end: ago(37) }],
    },
    {
      ref: "VOY-260017", vessel: "MV NORTHERN GRACE", termKey: "jeaDisch", fn: "DISCHARGE", port: "Jebel Ali", facility: "Berth 12",
      cargo: [{ name: "Rebar B500B", planned: 30000 }],
      handled: 27400, finished: false, cranes: ["Crane 1", "Crane 2"],
      events: [["ARRIVED", ago(190)], ["NOR_TENDERED", ago(186)], ["NOR_ACCEPTED", ago(185)], ["BERTHED", ago(170)], ["OPS_COMMENCED", ago(168)]],
      stops: [{ reason: "Shifting", start: ago(100), end: ago(97) }],
    },
    // ---- finished, newest first
    {
      ref: "VOY-260016", vessel: "MV AURORA STAR", termKey: "alexLoad", fn: "LOAD", port: "Alexandria", facility: "Quay 86",
      cargo: [{ name: "HRC coils", planned: 3052.403 }], handled: 3052.403, finished: true, cranes: ["Crane 1"], statement: "draft",
      events: [
        ["ARRIVED", at(A, 16, "21:25")], ["NOR_TENDERED", at(A, 14, "00:01")], ["BERTHED", at(A, 12, "08:00")],
        ["OPS_COMMENCED", at(A, 12, "15:50")], ["OPS_COMPLETED", at(A, 9, "00:05")], ["LASHING_COMPLETED", at(A, 9, "00:10")],
        ["DOCUMENTS_ON_BOARD", at(A, 9, "11:15")], ["DEPARTED", at(A, 9, "13:35")],
      ],
      stops: [
        { reason: "Rain", start: at(A, 11, "03:10"), end: at(A, 11, "05:40") },
        { reason: "Crane breakdown", start: at(A, 10, "13:00"), end: at(A, 10, "14:20") },
      ],
    },
    {
      ref: "VOY-260015", vessel: "MV BLUE MERIDIAN", termKey: "alexLoad", fn: "LOAD", port: "Alexandria", facility: "Quay 85",
      cargo: [{ name: "Rebar B500B", planned: 12000 }], handled: 12000, finished: true, cranes: ["Crane 1", "Crane 2", "Crane 3"], statement: "final",
      events: [
        ["ARRIVED", at(A, 41, "06:40")], ["NOR_TENDERED", at(A, 41, "09:30")], ["BERTHED", at(A, 41, "16:00")],
        ["OPS_COMMENCED", at(A, 41, "18:00")], ["OPS_COMPLETED", at(A, 39, "20:00")], ["LASHING_COMPLETED", at(A, 39, "22:30")],
        ["DOCUMENTS_ON_BOARD", at(A, 39, "23:30")], ["DEPARTED", at(A, 38, "04:00")],
      ],
      stops: [],
    },
    {
      ref: "VOY-260014", vessel: "MV IRON WREN", termKey: "jeaDisch", fn: "DISCHARGE", port: "Jebel Ali", facility: "Berth 12",
      cargo: [{ name: "Rebar B500B", planned: 25000 }], handled: 25000, finished: true, cranes: ["Crane 1", "Crane 2"], statement: "final",
      events: [
        ["ARRIVED", at(J, 72, "04:00")], ["NOR_TENDERED", at(J, 72, "06:00")], ["NOR_ACCEPTED", at(J, 72, "08:00")],
        ["BERTHED", at(J, 71, "10:00")], ["OPS_COMMENCED", at(J, 71, "12:00")], ["OPS_COMPLETED", at(J, 64, "18:37")],
        ["DEPARTED", at(J, 64, "23:00")],
      ],
      stops: [{ reason: "Shifting", start: at(J, 68, "09:00"), end: at(J, 68, "13:00") }],
    },
    {
      ref: "VOY-260013", vessel: "MV SILVER TERN", termKey: "damLoad", fn: "LOAD", port: "Damietta", facility: "Berth 7",
      cargo: [{ name: "Billets 5SP", planned: 16000 }], handled: 16000, finished: true, cranes: ["Crane A", "Crane B"], statement: "final",
      events: [
        ["ARRIVED", at(A, 103, "02:00")], ["NOR_TENDERED", at(A, 103, "04:00")], ["NOR_ACCEPTED", at(A, 103, "07:00")],
        ["BERTHED", at(A, 103, "12:00")], ["OPS_COMMENCED", at(A, 103, "14:00")], ["OPS_COMPLETED", at(A, 101, "02:40")],
        ["DEPARTED", at(A, 101, "08:00")],
      ],
      stops: [],
    },
    {
      ref: "VOY-260012", vessel: "MV CORAL BAY", termKey: "gemDisch", fn: "DISCHARGE", port: "Gemlik", facility: "Berth 2",
      cargo: [{ name: "Wire rod SAE1008", planned: 18000 }], handled: 18000, finished: true, cranes: ["Crane 1", "Crane 2"], statement: "final",
      events: [
        ["ARRIVED", at(G, 135, "10:00")], ["NOR_TENDERED", at(G, 135, "11:00")], ["NOR_ACCEPTED", at(G, 135, "13:00")],
        ["BERTHED", at(G, 134, "07:00")], ["OPS_COMMENCED", at(G, 134, "09:00")], ["OPS_COMPLETED", at(G, 129, "15:20")],
        ["DEPARTED", at(G, 129, "20:00")],
      ],
      stops: [{ reason: "Rain", start: at(G, 132, "06:00"), end: at(G, 132, "11:00") }],
    },
    {
      ref: "VOY-260011", vessel: "MV ORION PEAK", termKey: "alexLoad", fn: "LOAD", port: "Alexandria", facility: "Quay 86",
      cargo: [{ name: "Rebar B500B", planned: 6000 }, { name: "Wire rod SAE1008", planned: 3000 }], handled: 9000, finished: true,
      cranes: ["Crane 1", "Crane 2"], statement: "final",
      events: [
        ["ARRIVED", at(A, 164, "18:00")], ["NOR_TENDERED", at(A, 163, "10:00")], ["BERTHED", at(A, 162, "06:00")],
        ["OPS_COMMENCED", at(A, 162, "08:00")], ["OPS_COMPLETED", at(A, 157, "10:45")], ["LASHING_COMPLETED", at(A, 157, "12:10")],
        ["DOCUMENTS_ON_BOARD", at(A, 157, "16:00")], ["DEPARTED", at(A, 157, "18:00")],
      ],
      stops: [{ reason: "Friday prayer", start: at(A, 160, "11:30"), end: at(A, 160, "13:30") }],
    },
  ];

  const token = await createSession(ahmed.id, O);
  const summary: string[] = [];

  await runWithSession(token, async () => {
    for (const c of calls) {
      const tz = portTz[c.port];
      const [v] = await db
        .insert(voyages)
        .values({
          organizationId: O, voyageReference: c.ref, vesselName: c.vessel, contractId: termDefs[c.termKey].contract,
          status: c.finished ? "COMPLETED" : "ACTIVE",
          // Opened a few days before arrival, so "recent" lists read in voyage order.
          createdAt: new Date(c.events[0][1].getTime() - 3 * DAY),
        })
        .returning();
      const [pc] = await db
        .insert(voyagePortCalls)
        .values({
          organizationId: O, voyageId: v.id, portId: portId[c.port], facilityId: facId[`${c.port}/${c.facility}`],
          function: c.fn, sequence: 1, status: c.finished ? "COMPLETED" : "ACTIVE", effectiveTimezone: tz,
          contractLaytimeTermId: termId[c.termKey],
        })
        .returning();

      const planned = c.cargo.reduce((a, x) => a + x.planned, 0);
      for (const x of c.cargo) {
        const share = x.planned / planned;
        await db.insert(cargoPlans).values({
          organizationId: O, portCallId: pc.id, cargoId: cargoId[x.name], plannedQuantityMt: String(x.planned),
          actualQuantityMt: c.finished ? String(Math.round(c.handled * share * 1000) / 1000) : null,
        });
      }

      for (const [sem, when] of c.events) {
        await db.insert(operationalEvents).values({ organizationId: O, portCallId: pc.id, eventTypeId: typeOf(sem), occurredAt: when, recordedByUserId: karim.id });
      }
      for (const s of c.stops) {
        await db.insert(stoppages).values({ organizationId: O, portCallId: pc.id, reasonId: reasonId[s.reason], startTime: s.start, endTime: s.end, recordedByUserId: karim.id });
      }

      // Shift log: tonnage spread over the local days worked, per crane.
      const start = c.events.find(([s]) => s === "OPS_COMMENCED")![1].getTime();
      const endEv = c.events.find(([s]) => s === "OPS_COMPLETED");
      const end = endEv ? endEv[1].getTime() : NOW.getTime();
      const days: { date: string; hours: number }[] = [];
      for (let t = start; t < end; t += HOUR) {
        const d = localDate(new Date(t), tz);
        const last = days[days.length - 1];
        if (last && last.date === d) last.hours += 1;
        else days.push({ date: d, hours: 1 });
      }
      // Deterministic variation so days and cranes do not all read the same.
      const dayFactor = (i: number) => [1, 0.86, 1.12, 0.94, 1.07, 0.9, 1.03][i % 7];
      const craneWeight = [1, 0.87, 0.71, 0.93];
      const weightSum = days.reduce((a, d, i) => a + d.hours * dayFactor(i), 0);
      let left = Math.round(c.handled);
      const byCargo = c.cargo.map((x) => ({ ...x, left: Math.round(c.handled * (x.planned / planned)) }));
      const cw = c.cranes.map((_, i) => craneWeight[i % craneWeight.length]);
      const cwSum = cw.reduce((a, b) => a + b, 0);
      days.forEach((d, di) => {
        const dayQty = di === days.length - 1 ? left : Math.round((c.handled * d.hours * dayFactor(di)) / weightSum);
        left -= dayQty;
        let dayLeft = dayQty;
        c.cranes.forEach((crane, ci) => {
          const q = ci === c.cranes.length - 1 ? dayLeft : Math.round((dayQty * cw[ci]) / cwSum);
          dayLeft -= q;
          if (q <= 0) return;
          // Each crane works the cargo with the most left to handle.
          const target = byCargo.reduce((a, b) => (b.left > a.left ? b : a));
          target.left -= q;
          shiftRows.push({ portCallId: pc.id, cargo: target.name, date: d.date, crane, qty: q, facility: facId[`${c.port}/${c.facility}`] });
        });
      });
      for (const r of shiftRows.splice(0)) {
        await db.insert(shiftPerformances).values({
          organizationId: O, portCallId: r.portCallId, facilityId: r.facility, cargoId: cargoId[r.cargo], shiftDate: r.date,
          crane: r.crane, operationType: c.fn, quantityMt: String(r.qty), recordedByUserId: karim.id,
        });
      }

      if (c.finished) {
        const rc = await recalculatePortCall(pc.id);
        if (!rc.ok) throw new Error(`${c.vessel}: ${rc.message}`);
        let line = `${c.ref} ${c.vessel.padEnd(18)} ${rc.data.status}${rc.data.refusalCode ? ` (${rc.data.refusalCode})` : ""} ${rc.data.outcome ?? ""}`;
        if (c.statement) {
          const st = await buildStatementDraft(v.id);
          if (!st.ok) throw new Error(`${c.vessel} statement: ${st.message}`);
          line += ` · demurrage ${st.data.demurrageTotal} · despatch ${st.data.despatchTotal}`;
          if (c.statement === "final") {
            const f = await finalizeStatement(v.id);
            if (!f.ok) throw new Error(`${c.vessel} finalize: ${f.message}`);
            line += " · finalized";
          } else line += " · draft";
        }
        summary.push(line);
      } else {
        summary.push(`${c.ref} ${c.vessel.padEnd(18)} working now · ${c.handled} of ${planned} MT`);
      }
    }

    // A vessel waiting at Alexandria with nothing recorded yet — for the
    // SOF-upload part of the demo.
    const [va] = await db
      .insert(voyages)
      .values({ organizationId: O, voyageReference: "VOY-260020", vesselName: "MV ATLAS DAWN", contractId: cSolen, status: "ACTIVE", createdAt: ago(20) })
      .returning();
    const [pca] = await db
      .insert(voyagePortCalls)
      .values({
        organizationId: O, voyageId: va.id, portId: portId["Alexandria"], facilityId: facId["Alexandria/Quay 85"],
        function: "LOAD", sequence: 1, status: "ACTIVE", effectiveTimezone: A, contractLaytimeTermId: termId.alexLoad,
      })
      .returning();
    await db.insert(cargoPlans).values({ organizationId: O, portCallId: pca.id, cargoId: cargoId["Rebar B500B"], plannedQuantityMt: "7500" });
    summary.push("VOY-260020 MV ATLAS DAWN     waiting — for the SOF upload demo");
  });

  // The script session is not a login: remove it.
  const { sessions } = await import("@/db/schema");
  await db.delete(sessions).where(eq(sessions.id, token));

  console.log("\nDemo company: Bulk Trading");
  console.log("  Admin      : ahmed@bulk-trading.com (Ahmed Adel)");
  console.log("  Operations : karim@bulk-trading.com (Karim Samir)");
  console.log("  Password   : the DEMO_PASSWORD you set\n");
  for (const l of summary) console.log("  " + l);
  await pool.end();
}

const shiftRows: { portCallId: string; cargo: string; date: string; crane: string; qty: number; facility: string }[] = [];

main().catch(async (e) => {
  console.error("\nDEMO SEED FAILED:", e instanceof Error ? e.message : e);
  await pool.end();
  process.exit(1);
});
