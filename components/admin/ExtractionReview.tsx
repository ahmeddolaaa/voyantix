"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { localToDisplay, displayToLocal } from "@/lib/ingestion/local-time-text";
import { STOPPAGE_CATEGORY_LABEL } from "@/lib/ingestion/schema";
import type {
  SofExtraction,
  ExtractedEvent,
  ExtractedStoppage,
  LaytimeEventType,
  StoppageCategory,
} from "@/lib/ingestion/schema";
import {
  commitExtraction,
  type CommitSummary,
} from "@/lib/actions/commit-extraction";
import {
  Card,
  SectionHeading,
  StatusBadge,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";

/**
 * Extraction review — the trust step of SOF ingestion.
 *
 * The extractor's candidate events and stoppages are a first draft. The analyst
 * confirms, EDITS, adds, or excludes each one against the source before any of
 * it becomes a real operational record. Everything is editable — a review tool
 * that could not correct a wrong extraction would be worthless. Nothing here
 * writes to the database yet; this slice proves the review experience against a
 * fixture.
 */

const EVENT_TYPES: LaytimeEventType[] = [
  "ARRIVED",
  "NOR_TENDERED",
  "NOR_ACCEPTED",
  "NOR_RETENDERED",
  "BERTHED",
  "OPERATION_COMMENCED",
  "OPERATION_COMPLETED",
  "LASHING_COMPLETED",
  "DOCUMENTS_SIGNED",
  "DEPARTED",
];

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

const STOPPAGE_CATEGORIES: StoppageCategory[] = [
  "LABOUR_BREAK",
  "MEAL_BREAK",
  "RELIGIOUS",
  "WEATHER",
  "PORT_CLOSURE",
  "AWAITING_BERTH",
  "AWAITING_INSTRUCTIONS",
  "SHIFTING",
  "NO_GANG",
  "BREAKDOWN",
  "OTHER",
];

const STOPPAGE_LABEL: Record<StoppageCategory, string> = STOPPAGE_CATEGORY_LABEL;

const selectStyle = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
  borderRadius: "4px",
  padding: "3px 6px",
  fontSize: "12.5px",
} as const;

const inputStyle = {
  border: "1px solid var(--line)",
  background: "var(--card)",
  color: "var(--ink)",
  borderRadius: "4px",
  padding: "3px 6px",
  fontSize: "13px",
} as const;

/** A confidence pill — high is quiet, anything lower asks for attention. */
function Confidence({ value }: { value: number }) {
  const level = value >= 0.95 ? "high" : value >= 0.85 ? "check" : "low";
  const s =
    level === "high"
      ? { bg: "var(--teal-soft)", fg: "var(--teal)", label: "High" }
      : level === "check"
        ? { bg: "var(--rust-soft)", fg: "var(--rust)", label: "Check" }
        : { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Low" };
  return (
    <span
      className="num inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
      style={{ background: s.bg, color: s.fg }}
      title={`Confidence ${(value * 100).toFixed(0)}%`}
    >
      {s.label} · {(value * 100).toFixed(0)}%
    </span>
  );
}

function ManualTag() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
      style={{ background: "var(--brass-soft)", color: "#8a5a12" }}
    >
      Manual
    </span>
  );
}

type EventRow = ExtractedEvent & { included: boolean; origin: "ai" | "manual" };
type StoppageRow = ExtractedStoppage & {
  included: boolean;
  origin: "ai" | "manual";
};

function IncludeToggle({
  on,
  onClick,
}: {
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={on ? "Exclude" : "Include"}
      className="shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center text-[12px]"
      style={{
        background: on ? "var(--brand)" : "var(--card)",
        border: `1px solid ${on ? "var(--brand)" : "var(--line)"}`,
        color: "#fff",
      }}
    >
      {on ? "✓" : ""}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove row"
      className="shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center text-[13px]"
      style={{ color: "var(--steel)" }}
      title="Remove"
    >
      ✕
    </button>
  );
}

export function ExtractionReview({
  extraction,
  portCallId,
  voyageId,
}: {
  extraction: SofExtraction;
  /** When present, Commit writes to this port call; otherwise it is a preview. */
  portCallId?: string;
  voyageId?: string;
}) {
  const [events, setEvents] = useState<EventRow[]>(
    extraction.events.map((e) => ({ ...e, included: true, origin: "ai" }))
  );
  const [stoppages, setStoppages] = useState<StoppageRow[]>(
    extraction.stoppages.map((s) => ({ ...s, included: true, origin: "ai" }))
  );
  const [committed, setCommitted] = useState(false);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onCommit() {
    setCommitError(null);
    if (!portCallId) {
      setCommitted(true);
      return;
    }
    startTransition(async () => {
      const r = await commitExtraction(portCallId, {
        events: events
          .filter((e) => e.included)
          .map((e) => ({ type: e.type, occurredLocal: e.occurredLocal })),
        stoppages: stoppages
          .filter((s) => s.included)
          .map((s) => ({
            reasonCategory: s.reasonCategory,
            reasonText: s.reasonText,
            startLocal: s.startLocal,
            endLocal: s.endLocal,
          })),
      });
      if (r.ok) {
        setSummary(r.data);
        setCommitted(true);
      } else {
        setCommitError(r.message);
      }
    });
  }

  const confirmedCount = useMemo(
    () =>
      events.filter((e) => e.included).length +
      stoppages.filter((s) => s.included).length,
    [events, stoppages]
  );

  const doc = extraction.document;
  const muted = { color: "var(--steel)" } as const;

  const patchEvent = (i: number, patch: Partial<EventRow>) =>
    setEvents((p) => p.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const patchStoppage = (i: number, patch: Partial<StoppageRow>) =>
    setStoppages((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addEvent = () =>
    setEvents((p) => [
      ...p,
      {
        type: "ARRIVED",
        occurredLocal: "",
        sourceSnippet: "",
        confidence: 1,
        included: true,
        origin: "manual",
      },
    ]);
  const addStoppage = () =>
    setStoppages((p) => [
      ...p,
      {
        startLocal: "",
        endLocal: "",
        reasonText: "",
        reasonCategory: "OTHER",
        sourceSnippet: "",
        confidence: 1,
        included: true,
        origin: "manual",
      },
    ]);

  return (
    <div>
      <div
        className="flex items-center gap-3 flex-wrap rounded-[14px] px-5 py-4 mb-6"
        style={{ background: "var(--card)", border: "1px solid var(--line)" }}
      >
        <StatusBadge tone="neutral">{doc.kind}</StatusBadge>
        <span className="text-[13.5px]" style={{ color: "var(--ink)" }}>
          {[
            doc.vesselName,
            doc.port,
            doc.terminal,
            doc.operation === "LOAD" ? "Loading" : doc.operation === "DISCHARGE" ? "Discharging" : null,
            doc.cargoDescription,
            doc.cargoQuantityMt != null ? `Cargo ${doc.cargoQuantityMt.toLocaleString("en-GB")} MT` : null,
            doc.charterPartyDate ? `C/P ${localToDisplay(`${doc.charterPartyDate}T00:00`).slice(0, 10)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Document details not read"}
        </span>
        <span className="ml-auto text-[12px]" style={muted}>
          Check every row against the document before committing.
        </span>
      </div>

      <div className="lg:flex lg:gap-7">
        {/* Main: the candidate facts, each fully editable against its source. */}
        <div className="lg:flex-[1.7] min-w-0">
          <div className="flex items-center justify-between mb-3">
            <SectionHeading>Events</SectionHeading>
            <SecondaryButton
              onClick={addEvent}
              className="!px-2.5 !py-1 !text-[12px]"
            >
              + Add event
            </SecondaryButton>
          </div>
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
                <IncludeToggle on={e.included} onClick={() => patchEvent(i, { included: !e.included })} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={e.type}
                      onChange={(ev) =>
                        patchEvent(i, { type: ev.target.value as LaytimeEventType })
                      }
                      style={selectStyle}
                      aria-label="Event type"
                    >
                      {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {EVENT_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    <LocalTimeInput
                      value={e.occurredLocal}
                      onChange={(v) => patchEvent(i, { occurredLocal: v ?? "" })}
                      label={`${EVENT_LABEL[e.type]} time`}
                      style={{ ...inputStyle, width: "150px" }}
                    />
                    {e.origin === "manual" ? <ManualTag /> : <Confidence value={e.confidence} />}
                  </div>
                  {e.sourceSnippet && (
                    <div className="text-[12px] mt-1 truncate" style={muted}>
                      {e.sourceSnippet}
                    </div>
                  )}
                </div>
                <RemoveButton onClick={() => setEvents((p) => p.filter((_, idx) => idx !== i))} />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-3">
            <SectionHeading>Stoppages</SectionHeading>
            <SecondaryButton
              onClick={addStoppage}
              className="!px-2.5 !py-1 !text-[12px]"
            >
              + Add stoppage
            </SecondaryButton>
          </div>
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
                <IncludeToggle on={s.included} onClick={() => patchStoppage(i, { included: !s.included })} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={s.reasonCategory}
                      onChange={(ev) =>
                        patchStoppage(i, {
                          reasonCategory: ev.target.value as StoppageCategory,
                        })
                      }
                      style={selectStyle}
                      aria-label="Stoppage category"
                    >
                      {STOPPAGE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {STOPPAGE_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    <LocalTimeInput
                      value={s.startLocal}
                      onChange={(v) => patchStoppage(i, { startLocal: v ?? "" })}
                      label="Stoppage from"
                      style={{ ...inputStyle, width: "140px" }}
                    />
                    <span style={muted}>→</span>
                    <LocalTimeInput
                      value={s.endLocal ?? ""}
                      onChange={(v) => patchStoppage(i, { endLocal: v })}
                      label="Stoppage to"
                      allowEmpty
                      style={{ ...inputStyle, width: "140px" }}
                    />
                    {s.origin === "manual" ? <ManualTag /> : <Confidence value={s.confidence} />}
                  </div>
                  <input
                    value={s.reasonText}
                    onChange={(ev) => patchStoppage(i, { reasonText: ev.target.value })}
                    placeholder="reason"
                    className="mt-1.5 w-full"
                    style={{ ...inputStyle, fontSize: "12px", color: "var(--steel)" }}
                  />
                </div>
                <RemoveButton onClick={() => setStoppages((p) => p.filter((_, idx) => idx !== i))} />
              </div>
            ))}
          </div>
        </div>

        {/* Rail: conflicts to resolve, remarks, and the commit action. */}
        <div className="lg:flex-1 lg:max-w-[380px] min-w-0 mt-6 lg:mt-0">
          {extraction.conflicts.length > 0 && (
            <Card className="mb-4">
              <div className="text-[12.5px] font-medium mb-2" style={{ color: "var(--rust)" }}>
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
            {committed && summary ? (
              <div className="text-[13px]">
                <div
                  className="rounded p-3 mb-2"
                  style={{ background: "var(--teal-soft)", color: "var(--teal)" }}
                >
                  ✓ Committed {summary.committedEvents} event
                  {summary.committedEvents === 1 ? "" : "s"} and{" "}
                  {summary.committedStoppages} stoppage
                  {summary.committedStoppages === 1 ? "" : "s"}.
                </div>
                {summary.createdReasons.length > 0 && (
                  <div className="text-[11.5px] mb-2" style={muted}>
                    New stoppage reasons added: {summary.createdReasons.join(", ")}.
                  </div>
                )}
                {summary.reasonsWithoutRule.length > 0 && (
                  <div
                    className="text-[12px] rounded p-2.5 mb-2"
                    style={{ background: "var(--rust-soft)", border: "1px solid var(--rust)", color: "var(--ink)" }}
                  >
                    <strong>Next:</strong> the contract term has no rule yet for{" "}
                    <strong>{summary.reasonsWithoutRule.join(", ")}</strong>. Open the contract →{" "}
                    <em>Stoppage rules</em> and set whether each one counts; the calculation needs it.
                  </div>
                )}
                {summary.skipped.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[12px] font-medium mb-1" style={{ color: "var(--rust)" }}>
                      {summary.skipped.length} not committed
                    </div>
                    {summary.skipped.map((s, i) => (
                      <div key={i} className="text-[11.5px] mb-0.5" style={muted}>
                        • {s}
                      </div>
                    ))}
                  </div>
                )}
                {voyageId && (
                  <Link
                    href={`/admin/voyages/${voyageId}`}
                    className="text-[13px] no-underline"
                    style={{ color: "var(--teal)" }}
                  >
                    → Back to voyage
                  </Link>
                )}
              </div>
            ) : committed ? (
              <div
                className="text-[13px] rounded p-3"
                style={{ background: "var(--teal-soft)", color: "var(--teal)" }}
              >
                ✓ {confirmedCount} facts confirmed. Open this from a port call to
                commit them to a voyage.
              </div>
            ) : (
              <>
                {commitError && (
                  <div className="text-[12px] mb-2" style={{ color: "var(--danger)" }}>
                    {commitError}
                  </div>
                )}
                <PrimaryButton
                  className="w-full"
                  onClick={onCommit}
                  disabled={confirmedCount === 0 || pending}
                >
                  {pending ? "Committing…" : `Commit ${confirmedCount} facts`}
                </PrimaryButton>
              </>
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

/**
 * A SOF local time shown as "dd/mm/yyyy hh:mm". The typed text is kept while
 * editing; the stored value changes only when the text is a real date/time.
 * Unreadable text is flagged red and stored as empty, so Commit reports it as
 * unreadable instead of silently keeping an old value.
 */
function LocalTimeInput({
  value,
  onChange,
  label,
  allowEmpty = false,
  style,
}: {
  value: string;
  onChange: (local: string | null) => void;
  label: string;
  allowEmpty?: boolean;
  style: React.CSSProperties;
}) {
  const [text, setText] = useState(() => localToDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const [lastValue, setLastValue] = useState(value);
  // Follow outside changes (e.g. a new row) without clobbering typing.
  if (value !== lastValue) {
    setLastValue(value);
    setText(localToDisplay(value));
    setInvalid(false);
  }
  return (
    <input
      aria-label={label}
      value={text}
      placeholder="dd/mm/yyyy hh:mm"
      onChange={(ev) => {
        const t = ev.target.value;
        setText(t);
        // Record what we emit so the resulting prop change is not mistaken
        // for an outside change (which would wipe the text being typed).
        if (t.trim() === "") {
          setInvalid(!allowEmpty);
          const out = allowEmpty ? null : "";
          setLastValue(out ?? "");
          onChange(out);
          return;
        }
        const parsed = displayToLocal(t);
        setInvalid(parsed === null);
        setLastValue(parsed ?? "");
        onChange(parsed ?? "");
      }}
      className="num"
      style={{
        ...style,
        ...(invalid ? { borderColor: "var(--danger)", outlineColor: "var(--danger)" } : {}),
      }}
      title={invalid ? "Use dd/mm/yyyy hh:mm, e.g. 23/06/2026 00:01" : undefined}
    />
  );
}
