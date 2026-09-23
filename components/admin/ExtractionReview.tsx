"use client";

import { useMemo, useState } from "react";
import type {
  SofExtraction,
  ExtractedEvent,
  ExtractedStoppage,
  LaytimeEventType,
  StoppageCategory,
} from "@/lib/ingestion/schema";
import {
  Card,
  PageTitle,
  SectionHeading,
  StatusBadge,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";

/**
 * Extraction review — the trust step of SOF ingestion.
 *
 * The extractor's candidate events and stoppages are shown with their source
 * snippet and a confidence, and the analyst confirms, edits, or excludes each
 * one before it can become a real operational record. Nothing here writes to
 * the database yet; this slice proves the review experience against a fixture.
 */

const EVENT_LABEL: Record<LaytimeEventType, string> = {
  ARRIVED: "Arrived",
  NOR_TENDERED: "NOR tendered",
  NOR_ACCEPTED: "NOR accepted",
  NOR_RETENDERED: "NOR re-tendered",
  BERTHED: "Berthed",
  OPERATION_COMMENCED: "Operation commenced",
  OPERATION_COMPLETED: "Operation completed",
  LASHING_COMPLETED: "Lashing completed",
  DOCUMENTS_SIGNED: "Documents signed",
  DEPARTED: "Departed",
};

function eventTone(t: LaytimeEventType): "brass" | "teal" | "neutral" {
  if (t === "NOR_TENDERED" || t === "NOR_ACCEPTED" || t === "NOR_RETENDERED")
    return "brass";
  if (t === "OPERATION_COMMENCED" || t === "OPERATION_COMPLETED") return "teal";
  return "neutral";
}

const STOPPAGE_LABEL: Record<StoppageCategory, string> = {
  LABOUR_BREAK: "Labour break",
  MEAL_BREAK: "Meal break",
  RELIGIOUS: "Religious",
  WEATHER: "Weather",
  PORT_CLOSURE: "Port closure",
  AWAITING_BERTH: "Awaiting berth",
  AWAITING_INSTRUCTIONS: "Awaiting instructions",
  SHIFTING: "Shifting",
  NO_GANG: "No gang",
  BREAKDOWN: "Breakdown",
  OTHER: "Other",
};

function stoppageTone(c: StoppageCategory): "rust" | "neutral" {
  return c === "PORT_CLOSURE" ||
    c === "WEATHER" ||
    c === "BREAKDOWN" ||
    c === "AWAITING_BERTH" ||
    c === "AWAITING_INSTRUCTIONS"
    ? "rust"
    : "neutral";
}

/** A confidence pill — high is quiet, anything lower is asks-for-attention. */
function Confidence({ value }: { value: number }) {
  const level = value >= 0.95 ? "high" : value >= 0.85 ? "check" : "low";
  const style =
    level === "high"
      ? { bg: "var(--teal-soft)", fg: "var(--teal)", label: "High" }
      : level === "check"
        ? { bg: "var(--rust-soft)", fg: "var(--rust)", label: "Check" }
        : { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Low" };
  return (
    <span
      className="num inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
      style={{ background: style.bg, color: style.fg }}
      title={`Confidence ${(value * 100).toFixed(0)}%`}
    >
      {style.label} · {(value * 100).toFixed(0)}%
    </span>
  );
}

type EventRow = ExtractedEvent & { included: boolean };
type StoppageRow = ExtractedStoppage & { included: boolean };

export function ExtractionReview({ extraction }: { extraction: SofExtraction }) {
  const [events, setEvents] = useState<EventRow[]>(
    extraction.events.map((e) => ({ ...e, included: true }))
  );
  const [stoppages, setStoppages] = useState<StoppageRow[]>(
    extraction.stoppages.map((s) => ({ ...s, included: true }))
  );
  const [committed, setCommitted] = useState(false);

  const confirmedCount = useMemo(
    () =>
      events.filter((e) => e.included).length +
      stoppages.filter((s) => s.included).length,
    [events, stoppages]
  );

  const doc = extraction.document;
  const muted = { color: "var(--steel)" } as const;

  function toggleEvent(i: number) {
    setEvents((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, included: !e.included } : e))
    );
  }
  function editEventTime(i: number, v: string) {
    setEvents((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, occurredLocal: v } : e))
    );
  }
  function toggleStoppage(i: number) {
    setStoppages((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, included: !s.included } : s))
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-8">
      <div className="flex items-start justify-between mb-1">
        <PageTitle>Review extraction</PageTitle>
        <StatusBadge tone="neutral">{doc.kind}</StatusBadge>
      </div>
      <p className="text-[13px] mb-6" style={muted}>
        {doc.vesselName} · {doc.port}
        {doc.terminal ? ` · ${doc.terminal}` : ""} ·{" "}
        {doc.operation === "LOAD" ? "Loading" : "Discharging"} · Cargo{" "}
        {doc.cargoQuantityMt?.toLocaleString()} MT · C/P {doc.charterPartyDate}
      </p>

      <div className="lg:flex lg:gap-7">
        {/* Main: the candidate facts, each confirmable against its source. */}
        <div className="lg:flex-[1.7] min-w-0">
          <SectionHeading>Events</SectionHeading>
          <div
            className="rounded-lg overflow-hidden mb-6"
            style={{ background: "var(--card)", border: "1px solid var(--line)" }}
          >
            {events.map((e, i) => (
              <div
                key={i}
                className="flex items-start gap-3 px-4 py-3"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  opacity: e.included ? 1 : 0.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleEvent(i)}
                  aria-label={e.included ? "Exclude" : "Include"}
                  className="shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center text-[12px]"
                  style={{
                    background: e.included ? "var(--brand)" : "var(--card)",
                    border: `1px solid ${e.included ? "var(--brand)" : "var(--line)"}`,
                    color: "#fff",
                  }}
                >
                  {e.included ? "✓" : ""}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge tone={eventTone(e.type)}>
                      {EVENT_LABEL[e.type]}
                    </StatusBadge>
                    <input
                      value={e.occurredLocal}
                      onChange={(ev) => editEventTime(i, ev.target.value)}
                      className="num text-[13px] px-2 py-0.5 rounded"
                      style={{
                        border: "1px solid var(--line)",
                        background: "var(--card)",
                        color: "var(--ink)",
                        width: "150px",
                      }}
                    />
                    <Confidence value={e.confidence} />
                  </div>
                  <div className="text-[12px] mt-1 truncate" style={muted}>
                    {e.sourceSnippet}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <SectionHeading>Stoppages</SectionHeading>
          <div
            className="rounded-lg overflow-hidden"
            style={{ background: "var(--card)", border: "1px solid var(--line)" }}
          >
            {stoppages.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-3 px-4 py-3"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  opacity: s.included ? 1 : 0.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleStoppage(i)}
                  aria-label={s.included ? "Exclude" : "Include"}
                  className="shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center text-[12px]"
                  style={{
                    background: s.included ? "var(--brand)" : "var(--card)",
                    border: `1px solid ${s.included ? "var(--brand)" : "var(--line)"}`,
                    color: "#fff",
                  }}
                >
                  {s.included ? "✓" : ""}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge tone={stoppageTone(s.reasonCategory)}>
                      {STOPPAGE_LABEL[s.reasonCategory]}
                    </StatusBadge>
                    <span className="num text-[13px]" style={{ color: "var(--ink)" }}>
                      {s.startLocal.replace("T", " ")} →{" "}
                      {s.endLocal ? s.endLocal.replace("T", " ") : "—"}
                    </span>
                    <Confidence value={s.confidence} />
                  </div>
                  <div className="text-[12px] mt-1 truncate" style={muted}>
                    {s.reasonText}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rail: conflicts to resolve, remarks, and the commit action. */}
        <div className="lg:flex-1 lg:max-w-[380px] min-w-0 mt-6 lg:mt-0">
          {extraction.conflicts.length > 0 && (
            <Card className="mb-4">
              <div
                className="text-[12.5px] font-medium mb-2"
                style={{ color: "var(--rust)" }}
              >
                {extraction.conflicts.length} conflict
                {extraction.conflicts.length > 1 ? "s" : ""} to resolve
              </div>
              {extraction.conflicts.map((c, i) => (
                <div
                  key={i}
                  className="text-[12px] mb-2 pl-3"
                  style={{ color: "var(--ink-soft)", borderLeft: "2px solid var(--rust)" }}
                >
                  {c}
                </div>
              ))}
            </Card>
          )}

          <Card className="mb-4">
            <div className="text-[12.5px] font-medium mb-2" style={{ color: "var(--ink-soft)" }}>
              Source remarks (not counted)
            </div>
            {extraction.rawRemarks.map((r, i) => (
              <div key={i} className="text-[12px] mb-1.5" style={muted}>
                • {r}
              </div>
            ))}
          </Card>

          <Card>
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-[13px]" style={muted}>
                Confirmed facts
              </span>
              <span className="num text-[22px] font-semibold" style={{ color: "var(--brand)" }}>
                {confirmedCount}
              </span>
            </div>
            {committed ? (
              <div
                className="text-[13px] rounded p-3"
                style={{ background: "var(--teal-soft)", color: "var(--teal)" }}
              >
                ✓ {confirmedCount} facts ready to commit to the voyage. (Wiring to
                the engine is the next slice.)
              </div>
            ) : (
              <PrimaryButton
                className="w-full"
                onClick={() => setCommitted(true)}
                disabled={confirmedCount === 0}
              >
                Commit {confirmedCount} facts
              </PrimaryButton>
            )}
            <p className="text-[11.5px] mt-2" style={muted}>
              Extracted by {extraction.extractionModel}. Every fact keeps its
              source snippet for the audit trail.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
