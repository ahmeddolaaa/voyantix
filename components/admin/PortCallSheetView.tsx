"use client";

import type { PortCallSheet } from "@/lib/actions/port-call-sheet";
import { getLocalParts } from "@/lib/laytime/timezone";
import { sheetBalanceSeconds } from "@/lib/format";

/**
 * The detailed laytime sheet of ONE port call, laid out like a laytime
 * calculation sheet (evidence: MY FELLAS loading calculation): header, events,
 * terms, the time-sheet with comments, and the totals. Display only.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number) => String(n).padStart(2, "0");

function localDate(d: Date, tz: string): string {
  const p = getLocalParts(d, tz);
  return `${p2(p.day)}/${p2(p.month)}/${String(p.year).slice(2)}`;
}
function localTime(d: Date, tz: string): string {
  const p = getLocalParts(d, tz);
  return `${p2(p.hour)}:${p2(p.minute)}`;
}
function weekday(d: Date, tz: string, short = false): string {
  const p = getLocalParts(d, tz);
  const w = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return (short ? WEEKDAYS_SHORT : WEEKDAYS)[w];
}
/** "04 D 21 H 15 M" — rounded to the nearest minute, like the sheets. */
function dhm(seconds: number): string {
  let m = Math.round(Math.abs(seconds) / 60);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  return `${p2(d)} D ${p2(h)} H ${p2(m)} M`;
}
/** Sheet-style "dd hh mm" with truncation to the minute (as the totals are shown). */
function ddhhmm(seconds: number): string {
  let m = Math.floor(Math.abs(seconds) / 60);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  return `${p2(d)}  ${p2(h)}  ${p2(m)}`;
}
const days6 = (s: number) => (Math.abs(s) / 86400).toFixed(6);
/** Money on the sheet always shows two decimals: 3,500.00 / 13,537.82. */
const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PortCallSheetView({ sheet, title }: { sheet: PortCallSheet; title: string }) {
  const tz = sheet.timeZone;
  const muted = { color: "var(--steel)" } as const;
  const th = "px-2 py-1.5 text-[10.5px] uppercase tracking-wide text-left";
  const td = "px-2 py-1 text-[12px] align-top";

  // Events + the laytime-commenced line, in time order.
  const events = [
    ...sheet.events.map((e) => ({ label: e.label, at: new Date(e.at), strong: false })),
    { label: "Laytime commenced", at: new Date(sheet.commencementAt), strong: true },
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const endAt = new Date(sheet.windowEnd).getTime();

  const over = sheet.outcome === "EXCEEDED";
  const shownBalance = sheetBalanceSeconds(sheet.allowedSeconds, sheet.usedSeconds);
  const balanceDays =
    sheet.settlement.kind === "demurrage" || sheet.settlement.kind === "despatch"
      ? sheet.dayPrecision === "EXACT"
        ? sheet.settlement.days.toFixed(6)
        : sheet.settlement.days.toFixed(5)
      : days6(sheet.balanceSeconds);

  let lastDate = "";

  return (
    <section className="sheet-page mt-8 pt-6" style={{ borderTop: "2px solid var(--brand)", breakBefore: "page" }}>
      <div className="font-display text-[16px] font-bold mb-3" style={{ color: "var(--ink)" }}>
        Laytime calculation — {title}
      </div>

      {/* Header */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] mb-4">
        <div><span style={muted}>Port of call: </span>{sheet.portName}</div>
        <div><span style={muted}>Type of operations: </span>{sheet.operation === "LOAD" ? "Loading" : "Discharging"}</div>
        <div>
          <span style={muted}>Charter party: </span>
          {sheet.contractReference ?? "—"}
          {sheet.contractDate ? ` dated ${sheet.contractDate.split("-").reverse().join("/")}` : ""}
        </div>
        <div><span style={muted}>Cargo: </span>{sheet.cargo}</div>
      </div>

      {/* Events */}
      <table className="w-full border-collapse mb-4" style={{ border: "1px solid var(--line)" }}>
        <thead>
          <tr style={{ background: "var(--bg)", color: "var(--steel)" }}>
            <th className={th}>Event</th>
            <th className={th}>Week day</th>
            <th className={th}>Day – Time</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            const isEnd = !e.strong && e.at.getTime() === endAt;
            return (
              <tr key={i} style={{ borderTop: "1px solid var(--line)", fontWeight: e.strong || isEnd ? 600 : 400 }}>
                <td className={td}>
                  {e.label}
                  {isEnd && <span style={{ ...muted, fontWeight: 400 }}> — laytime ends</span>}
                </td>
                <td className={td}>{weekday(e.at, tz)}</td>
                <td className={`${td} num`}>{localDate(e.at, tz)} {localTime(e.at, tz)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Terms */}
      <div className="grid grid-cols-[200px_1fr] gap-y-1 text-[12.5px] mb-4">
        <span style={muted}>Laytime allowance</span><span>{sheet.terms.allowance} · {sheet.terms.ruleSet}</span>
        <span style={muted}>Commencement</span><span>{sheet.terms.commencement}</span>
        <span style={muted}>Laytime ends at</span><span>{sheet.terms.laytimeEnds}</span>
        {sheet.terms.onceOnDemurrage && (<><span style={muted}>Demurrage clause</span><span>Once on demurrage, always on demurrage</span></>)}
        <span style={muted}>Time allowed</span>
        <span className="num">dd hh mm&nbsp;&nbsp;{ddhhmm(sheet.allowedSeconds)}&nbsp;&nbsp;&nbsp;{days6(sheet.allowedSeconds)} (days)</span>
      </div>

      {/* Time-sheet */}
      <table className="w-full border-collapse mb-4" style={{ border: "1px solid var(--line)" }}>
        <thead>
          <tr style={{ background: "var(--bg)", color: "var(--steel)" }}>
            <th className={th}>Date</th>
            <th className={th}>From</th>
            <th className={th}>To</th>
            <th className={th}>Comments</th>
            <th className={th} style={{ textAlign: "right" }}>Time to count</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((r, i) => {
            const start = new Date(r.start);
            const end = new Date(r.end);
            const date = localDate(start, tz);
            const showDate = date !== lastDate;
            lastDate = date;
            const endsNextMidnight = localDate(end, tz) !== date && localTime(end, tz) === "00:00";
            return (
              <tr key={i} style={{ borderTop: showDate ? "1px solid var(--line)" : undefined, color: r.counted ? "var(--ink)" : "var(--steel)" }}>
                <td className={`${td} num whitespace-nowrap`}>{showDate ? `${weekday(start, tz, true)} ${date}` : ""}</td>
                <td className={`${td} num`}>{localTime(start, tz)}</td>
                <td className={`${td} num`}>{endsNextMidnight ? "24:00" : localTime(end, tz)}</td>
                <td className={td}>{r.comment}</td>
                <td className={`${td} num whitespace-nowrap`} style={{ textAlign: "right" }}>{dhm(r.countedSeconds)}</td>
              </tr>
            );
          })}
          <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 600 }}>
            <td className={td} colSpan={4}>Total</td>
            <td className={`${td} num whitespace-nowrap`} style={{ textAlign: "right" }}>{dhm(sheet.usedSeconds)}</td>
          </tr>
        </tbody>
      </table>

      {/* Totals */}
      <div className="grid grid-cols-[200px_1fr] gap-y-1 text-[12.5px]">
        <span style={muted}>Time used</span>
        <span className="num">dd hh mm&nbsp;&nbsp;{ddhhmm(sheet.usedSeconds)}&nbsp;&nbsp;&nbsp;{days6(sheet.usedSeconds)} (days)</span>
        <span style={muted}>Time allowed</span>
        <span className="num">dd hh mm&nbsp;&nbsp;{ddhhmm(sheet.allowedSeconds)}&nbsp;&nbsp;&nbsp;{days6(sheet.allowedSeconds)} (days)</span>
        <span style={{ ...muted, fontWeight: 600 }}>{over ? "Time on demurrage" : "Time saved"}</span>
        <span className="num" style={{ fontWeight: 600 }}>
          dd hh mm&nbsp;&nbsp;{ddhhmm(shownBalance)}&nbsp;&nbsp;&nbsp;{balanceDays} (days)
        </span>
      </div>

      <div className="grid grid-cols-[200px_1fr] gap-y-1 text-[12.5px] mt-3 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
        {sheet.settlement.kind === "demurrage" || sheet.settlement.kind === "despatch" ? (
          <>
            <span style={muted}>{sheet.settlement.kind === "demurrage" ? "Demurrage rate per day" : "Despatch rate per day"}</span>
            <span className="num">{money(sheet.settlement.rate)}</span>
            <span style={{ fontWeight: 700 }}>{sheet.settlement.kind === "demurrage" ? "Demurrage value" : "Despatch value"}</span>
            <span className="num" style={{ fontWeight: 700, color: "var(--brand)" }}>{money(sheet.settlement.amount)}</span>
          </>
        ) : sheet.settlement.kind === "refused" ? (
          <><span style={muted}>Settlement</span><span>{sheet.settlement.reason}</span></>
        ) : (
          <><span style={muted}>Settlement</span><span>Nothing owed{over ? "" : " (no despatch configured)"}</span></>
        )}
      </div>
    </section>
  );
}
