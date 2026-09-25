"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { SofExtraction } from "@/lib/ingestion/schema";
import { extractSofDocument } from "@/lib/actions/sof-extract";
import { ExtractionReview } from "@/components/admin/ExtractionReview";

/**
 * Import a statement of facts: upload a PDF or photo → the document is read
 * (Gemini) into a candidate extraction → the analyst reviews every row
 * against the source → commit writes the confirmed facts to the port call.
 * Nothing is stored until the analyst commits.
 */

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

function Steps({ at }: { at: 1 | 2 | 3 }) {
  const items = ["Upload", "Review", "Commit"];
  return (
    <ol className="flex items-center gap-2 m-0 p-0 list-none" aria-label="Import steps">
      {items.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < at;
        const on = n === at;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold"
              style={{
                background: done ? "var(--teal)" : on ? "var(--navy)" : "var(--line-soft)",
                color: done || on ? "#fff" : "var(--steel)",
              }}
              aria-current={on ? "step" : undefined}
            >
              {done ? "✓" : n}
            </span>
            <span className="text-[13px] font-medium" style={{ color: on ? "var(--navy)" : "var(--steel)" }}>
              {label}
            </span>
            {i < items.length - 1 && <span className="w-8 h-px mx-1" style={{ background: "var(--line)" }} />}
          </li>
        );
      })}
    </ol>
  );
}

export function SofImportScreen({
  portCallId,
  voyageId,
  contextLabel,
}: {
  portCallId?: string;
  voyageId?: string;
  /** e.g. "MV CAPE HALDEN · 1 · Alexandria" */
  contextLabel?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<SofExtraction | null>(null);
  const [pending, start] = useTransition();

  function pick(f: File | null | undefined) {
    setError(null);
    if (!f) return;
    if (!ACCEPT.split(",").includes(f.type)) {
      setError("Only PDF, PNG, JPG or WEBP files can be read.");
      return;
    }
    setFile(f);
  }

  function read() {
    if (!file) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      if (portCallId) fd.set("portCallId", portCallId);
      const r = await extractSofDocument(fd);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setExtraction(r.data);
    });
  }

  const header = (
    <div className="flex flex-col gap-3 mb-6">
      {voyageId && (
        <Link
          href={`/admin/voyages/${voyageId}`}
          className="text-[12.5px] font-medium no-underline hover:underline self-start"
          style={{ color: "var(--teal)" }}
        >
          ← Back to voyage
        </Link>
      )}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          {contextLabel && (
            <span className="text-[11.5px] font-semibold uppercase tracking-[.12em]" style={{ color: "var(--steel)" }}>
              {contextLabel}
            </span>
          )}
          <h1 className="m-0 font-display text-[28px] font-bold" style={{ color: "var(--navy)" }}>
            Import statement of facts
          </h1>
        </div>
        <div className="ml-auto">
          <Steps at={extraction ? 2 : 1} />
        </div>
      </div>
    </div>
  );

  if (extraction) {
    return (
      <div className="max-w-[1320px] mx-auto px-6 lg:px-9 py-8">
        {header}
        <div className="flex items-center gap-3 mb-4 text-[13px]" style={{ color: "var(--ink-soft)" }}>
          <span>
            Read from <b>{file?.name}</b> · {extraction.events.length} events · {extraction.stoppages.length} stoppages
          </span>
          <button
            type="button"
            onClick={() => {
              setExtraction(null);
              setFile(null);
            }}
            className="ml-auto font-medium underline"
            style={{ color: "var(--teal)" }}
          >
            Upload a different document
          </button>
        </div>
        <ExtractionReview extraction={extraction} portCallId={portCallId} voyageId={voyageId} />
      </div>
    );
  }

  return (
    <div className="max-w-[1320px] mx-auto px-6 lg:px-9 py-8">
      {header}
      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="flex flex-col gap-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a statement of facts to upload"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                input.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className="rounded-[14px] px-8 py-14 flex flex-col items-center gap-3 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]"
            style={{
              border: `2px dashed ${drag ? "var(--brass)" : "var(--line)"}`,
              background: drag ? "var(--brass-soft)" : "var(--card)",
            }}
          >
            <span
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--line-soft)", color: "var(--navy)" }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 16V4M7 9l5-5 5 5" />
                <path d="M4 16v4h16v-4" />
              </svg>
            </span>
            <span className="font-display text-[18px] font-semibold" style={{ color: "var(--navy)" }}>
              {file ? file.name : "Drop the SOF here, or click to choose"}
            </span>
            <span className="text-[13px]" style={{ color: "var(--steel)" }}>
              {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ready to read` : "PDF or a photo of the page · up to 15 MB"}
            </span>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>

          {error && (
            <div role="alert" className="rounded-xl px-4 py-3 text-[13px]" style={{ background: "var(--coral-soft)", color: "var(--coral)" }}>
              {error}
            </div>
          )}

          {pending ? (
            <div className="rounded-[14px] p-5 flex flex-col gap-3" style={{ background: "var(--card)", border: "1px solid var(--line)" }} aria-live="polite">
              <div className="flex items-center gap-2.5">
                <span className="vx-live" />
                <span className="text-[14px] font-semibold">Reading the document…</span>
                <span className="text-[12.5px]" style={{ color: "var(--steel)" }}>
                  usually 10–40 seconds
                </span>
              </div>
              {[92, 78, 85, 64].map((w, i) => (
                <div key={i} className="h-3 rounded-md vx-shimmer" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={read}
              disabled={!file}
              className="self-start inline-flex items-center gap-2 h-11 px-5 rounded-[10px] text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--navy)", color: "#fff" }}
            >
              Read document
            </button>
          )}
        </div>

        <aside className="rounded-[14px] p-5 flex flex-col gap-3" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          <h2 className="m-0 font-display text-[16px] font-semibold">What happens</h2>
          {[
            ["Read", "The events that move the laytime clock (NOR, berthing, commenced, completed, documents…) and every stoppage with its reason are read off the document, each with the line it came from."],
            ["Review", "You check every row against the source, fix times, untick what should not count, and add anything missed. Low-confidence readings are flagged."],
            ["Commit", "Only what you confirm is written to the port call, and the laytime is recalculated from it."],
          ].map(([t, d]) => (
            <div key={t} className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-semibold">{t}</span>
              <span className="text-[12.5px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
                {d}
              </span>
            </div>
          ))}
          <p className="m-0 pt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--steel)", borderTop: "1px solid var(--line-soft)" }}>
            The document is sent to Google&apos;s Gemini service to be read and is not kept by Voyantix.
          </p>
        </aside>
      </div>
    </div>
  );
}
