"use client";

import { useMemo, useState } from "react";
import type { OperationalEventRow } from "@/lib/actions/operational-events";
import type { StoppageRow } from "@/lib/actions/stoppages";
import { StatusBadge } from "@/components/ui";
import { formatInstant, formatDurationSeconds } from "@/lib/format";

/**
 * Statement-of-Facts timeline for one port call: every recorded fact —
 * operational events and stoppage start/end marks — merged onto one
 * chronological track in the port's local time, with the elapsed gap shown
 * between consecutive marks. Read-only; the editors above remain the way facts
 * are entered. Superseded events are omitted (only the live record is a fact).
 */

type EventTypeOption = {
  id: string;
  label: string;
  systemSemantic: string | null;
  status: "active" | "inactive";
};

type Mark = {
  at: Date;
  label: string;
  kind: "event" | "stoppage-start" | "stoppage-end";
  semantic: string | null;
};

function markTone(m: Mark): "teal" | "rust" | "neutral" | "brass" {
  if (m.kind === "stoppage-start") return "rust";
  if (m.kind === "stoppage-end") return "teal";
  if (m.semantic === "NOR_TENDERED" || m.semantic === "NOR_ACCEPTED") return "brass";
  if (m.semantic === "OPS_COMMENCED" || m.semantic === "OPS_COMPLETED") return "teal";
  return "neutral";
}

export function PortCallTimeline({
  events,
  stoppages,
  eventTypes,
  reasons,
  timeZone,
}: {
  events: OperationalEventRow[];
  stoppages: StoppageRow[];
  eventTypes: EventTypeOption[];
  reasons: { id: string; name: string }[];
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);

  const marks = useMemo<Mark[]>(() => {
    const typeLabel = (id: string) => eventTypes.find((t) => t.id === id)?.label ?? "Event";
    const typeSemantic = (id: string) => eventTypes.find((t) => t.id === id)?.systemSemantic ?? null;
    const reasonName = (id: string) => reasons.find((r) => r.id === id)?.name ?? "Stoppage";

    const out: Mark[] = [];
    for (const e of events) {
      if (e.supersededByEventId !== null) continue;
      out.push({
        at: new Date(e.occurredAt),
        label: typeLabel(e.eventTypeId),
        kind: "event",
        semantic: typeSemantic(e.eventTypeId),
      });
    }
    for (const s of stoppages) {
      out.push({
        at: new Date(s.startTime),
        label: `${reasonName(s.reasonId)} — commenced`,
        kind: "stoppage-start",
        semantic: null,
      });
      if (s.endTime) {
        out.push({
          at: new Date(s.endTime),
          label: `${reasonName(s.reasonId)} — ceased`,
          kind: "stoppage-end",
          semantic: null,
        });
      }
    }
    out.sort((a, b) => a.at.getTime() - b.at.getTime());
    return out;
  }, [events, stoppages, eventTypes, reasons]);

  const muted = { color: "var(--steel)" } as const;

  return (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12.5px]" style={{ fontWeight: 500, color: "var(--ink-soft)" }}>
          Statement of facts
        </span>
        {marks.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[12px] underline"
            style={{ color: "var(--brass)" }}
          >
            {open ? "Hide" : "Show"} timeline ({marks.length})
          </button>
        )}
      </div>

      {marks.length === 0 && (
        <p className="text-[12.5px]" style={muted}>
          No events or stoppages recorded yet.
        </p>
      )}

      {open && marks.length > 0 && (
        <div className="mt-2">
          {marks.map((m, i) => {
            const prev = i > 0 ? marks[i - 1] : null;
            const gapSeconds = prev ? (m.at.getTime() - prev.at.getTime()) / 1000 : 0;
            const last = i === marks.length - 1;
            const tone = markTone(m);
            const dotColor =
              tone === "rust"
                ? "var(--rust)"
                : tone === "teal"
                  ? "var(--teal)"
                  : tone === "brass"
                    ? "var(--brass)"
                    : "var(--steel)";
            return (
              <div key={i} className="flex items-stretch gap-3 text-[12.5px]">
                <span
                  className="num shrink-0 w-[96px] text-right pt-[1px]"
                  style={muted}
                >
                  {formatInstant(m.at, timeZone)}
                </span>
                {/* Timeline spine: a bead per fact, joined by a continuous
                    hairline so the port call reads as one chronological track. */}
                <div className="shrink-0 flex flex-col items-center">
                  <span
                    className="mt-[5px] w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: dotColor, boxShadow: "0 0 0 2px var(--card)" }}
                  />
                  {!last && (
                    <span
                      className="flex-1 w-px my-0.5"
                      style={{ background: "var(--line)" }}
                    />
                  )}
                </div>
                <div className={last ? "" : "pb-3"}>
                  <span style={{ color: "var(--ink)" }}>{m.label}</span>
                  {prev && gapSeconds > 0 && (
                    <span className="num text-[11px] ml-2" style={muted}>
                      +{formatDurationSeconds(gapSeconds)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
