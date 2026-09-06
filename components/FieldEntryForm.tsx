"use client";

import { useState, useTransition } from "react";
import { PrimaryButton, SecondaryButton } from "./ui";
import type { FieldEntryResult } from "@/lib/actions/voyages";

export function FieldEntryForm({
  reasons,
  action,
}: {
  reasons: { id: string; name: string }[];
  action: (formData: FormData) => Promise<FieldEntryResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  function nowLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.error);
      } else {
        setStartTime("");
        setEndTime("");
      }
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
        Reason
        <select name="reasonId" required className="input">
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
        Start time
        <div className="flex gap-2">
          <input
            name="startTime"
            type="datetime-local"
            required
            className="input flex-1"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <SecondaryButton type="button" onClick={() => setStartTime(nowLocal())}>
            Now
          </SecondaryButton>
        </div>
      </label>

      <label className="flex flex-col gap-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
        End time <span style={{ color: "var(--steel)" }}>(leave blank to keep it open)</span>
        <div className="flex gap-2">
          <input
            name="endTime"
            type="datetime-local"
            className="input flex-1"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
          <SecondaryButton type="button" onClick={() => setEndTime(nowLocal())}>
            Now
          </SecondaryButton>
        </div>
      </label>

      {error && (
        <div
          className="text-[13px] px-3 py-2 rounded"
          style={{ background: "var(--rust-soft)", color: "var(--rust)" }}
        >
          {error}
        </div>
      )}

      <div>
        <PrimaryButton type="submit" disabled={isPending}>
          {isPending ? "Recording…" : "Record stoppage"}
        </PrimaryButton>
      </div>

      <style>{`.input{border:1px solid var(--line);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--card);color:var(--ink);}`}</style>
    </form>
  );
}
