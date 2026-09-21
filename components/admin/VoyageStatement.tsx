"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, useCallback } from "react";
import {
  getStatement,
  buildStatementDraft,
  finalizeStatement,
  addAdjustment,
  deleteAdjustment,
  type StatementView,
  type StatementScope,
} from "@/lib/actions/laytime-statements";
import { Card, SectionHeading, SecondaryButton, DangerButton, StatusBadge } from "@/components/ui";
import { Field, TextInput, FormError, SubmitButton } from "@/components/forms";
import { formatInstant, formatAmount } from "@/lib/format";

/**
 * Voyage-level laytime statement.
 *
 * A statement rolls every calculated port call of the voyage into one
 * document: each port call's settled outcome, plus manual money adjustments,
 * netted into a single claim. It has a strict lifecycle — one working DRAFT,
 * then a single canonical FINALIZED statement that locks. Adjustments are a
 * settlement-side ledger; they never touch the engine's balances.
 */

function scopeSettlement(s: StatementScope): { tone: "rust" | "teal" | "neutral"; text: string } {
  switch (s.settlementKind) {
    case "demurrage":
      return { tone: "rust", text: `Demurrage ${s.amount === null ? "" : formatAmount(s.amount)}` };
    case "despatch":
      return { tone: "teal", text: `Despatch ${s.amount === null ? "" : formatAmount(s.amount)}` };
    case "none":
      return { tone: "neutral", text: "Nothing owed" };
    case "settlement_refused":
      return { tone: "neutral", text: "Despatch basis undefined" };
    case "calc_refused":
      return { tone: "neutral", text: "Calculation refused" };
  }
}

export function VoyageStatement({
  voyageId,
  timeZone,
  portCallLabels,
}: {
  voyageId: string;
  timeZone: string;
  portCallLabels: Record<string, string>;
}) {
  const [stmt, setStmt] = useState<StatementView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const load = useCallback(async () => {
    const r = await getStatement(voyageId);
    if (!r.ok) {
      setError(r.message);
      setLoaded(true);
      return;
    }
    setStmt(r.data);
    setLoaded(true);
  }, [voyageId]);

  useEffect(() => {
    void load();
  }, [load]);

  function build() {
    setError(null);
    startTransition(async () => {
      const r = await buildStatementDraft(voyageId);
      if (!r.ok) return setError(r.message);
      await load();
    });
  }

  function finalize() {
    setError(null);
    startTransition(async () => {
      const r = await finalizeStatement(voyageId);
      if (!r.ok) return setError(r.message);
      await load();
    });
  }

  function addAdj() {
    if (!stmt) return;
    setError(null);
    const amount = Number(adjAmount);
    if (!Number.isFinite(amount)) return setError("Amount must be a number.");
    if (adjReason.trim() === "") return setError("A reason is required.");
    startTransition(async () => {
      const r = await addAdjustment(stmt.id, { amount, reason: adjReason.trim() });
      if (!r.ok) return setError(r.message);
      setAdjAmount("");
      setAdjReason("");
      await load();
    });
  }

  function removeAdj(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await deleteAdjustment(id);
      if (!r.ok) return setError(r.message);
      await load();
    });
  }

  const muted = { color: "var(--steel)" } as const;
  const label = (portCallId: string | null) =>
    portCallId ? portCallLabels[portCallId] ?? "Port call" : "Pool";
  const isDraft = stmt?.status === "draft";

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2">
          <SectionHeading>Statement</SectionHeading>
          {stmt && (
            <StatusBadge tone={stmt.status === "finalized" ? "brass" : "neutral"}>
              {stmt.status === "finalized" ? "Finalized" : "Draft"}
            </StatusBadge>
          )}
        </div>
        <div className="inline-flex gap-2 items-center">
          {stmt && (
            <Link
              href={`/admin/voyages/${voyageId}/statement`}
              className="text-[12px] no-underline"
              style={{ color: "var(--brass)" }}
            >
              View as document →
            </Link>
          )}
          {isDraft && (
            <SubmitButton onClick={finalize} pending={pending}>
              Finalize
            </SubmitButton>
          )}
          {stmt?.status !== "finalized" && (
            <SecondaryButton onClick={build} disabled={pending} className="!px-2.5 !py-1 !text-[12px]">
              {pending ? "Working…" : stmt ? "Rebuild draft" : "Build draft"}
            </SecondaryButton>
          )}
        </div>
      </div>

      {error && <FormError message={error} />}

      {loaded && !stmt && (
        <p className="text-[13px]" style={muted}>
          No statement yet. Build a draft to roll up the calculated port calls.
        </p>
      )}

      {stmt && (
        <>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-1 text-[13px] mb-3">
            <span>
              <span style={muted}>Demurrage </span>
              <span className="num">{formatAmount(stmt.demurrageTotal)}</span>
            </span>
            <span>
              <span style={muted}>Despatch </span>
              <span className="num">{formatAmount(stmt.despatchTotal)}</span>
            </span>
            <span>
              <span style={muted}>Adjustments </span>
              <span className="num">{formatAmount(stmt.adjustmentsTotal)}</span>
            </span>
            <span>
              <span style={muted}>Net claim </span>
              <span className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>
                {formatAmount(stmt.netClaim)}
              </span>
            </span>
            {stmt.unresolvedCount > 0 && (
              <StatusBadge tone="rust">{stmt.unresolvedCount} unresolved</StatusBadge>
            )}
          </div>

          {stmt.scopes.length === 0 ? (
            <p className="text-[13px]" style={muted}>
              No calculated port calls yet. Calculate the port calls, then rebuild the draft.
            </p>
          ) : (
            <div className="rounded-md overflow-hidden mb-3" style={{ border: "1px solid var(--line)" }}>
              {stmt.scopes.map((s, i) => {
                const set = scopeSettlement(s);
                return (
                  <div
                    key={(s.portCallId ?? "pool") + i}
                    className="flex items-center justify-between px-3 py-2 text-[13px]"
                    style={{ borderTop: i === 0 ? undefined : "1px solid var(--line)" }}
                  >
                    <span style={{ fontWeight: 500 }}>{label(s.portCallId)}</span>
                    <span className="inline-flex items-center gap-2">
                      {s.balanceOutcome && (
                        <span style={muted}>
                          {s.balanceOutcome === "SAVED"
                            ? "Saved"
                            : s.balanceOutcome === "EXCEEDED"
                              ? "Exceeded"
                              : "On the mark"}
                        </span>
                      )}
                      <StatusBadge tone={set.tone}>{set.text}</StatusBadge>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Adjustments */}
          <div className="pt-2" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="text-[12.5px] mb-2" style={{ fontWeight: 500, color: "var(--ink-soft)" }}>
              Adjustments
            </div>

            {stmt.adjustments.length === 0 && (
              <p className="text-[12.5px] mb-2" style={muted}>
                None. Add a manual correction (negative reduces the claim).
              </p>
            )}

            {stmt.adjustments.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-1 text-[13px]">
                <span>
                  <span className="num" style={{ fontWeight: 500 }}>
                    {formatAmount(a.amount)}
                  </span>
                  <span style={muted}> · {a.reason}</span>
                </span>
                {isDraft && (
                  <DangerButton
                    onClick={() => removeAdj(a.id)}
                    disabled={pending}
                    className="!px-2 !py-0.5 !text-[11.5px]"
                  >
                    Remove
                  </DangerButton>
                )}
              </div>
            ))}

            {isDraft && (
              <div className="grid md:grid-cols-2 gap-x-4 mt-2">
                <Field label="Amount" description="Negative reduces the claim">
                  {(a) => (
                    <TextInput
                      {...a}
                      value={adjAmount}
                      disabled={pending}
                      inputMode="decimal"
                      placeholder="-500"
                      onChange={(e) => setAdjAmount(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Reason">
                  {(a) => (
                    <TextInput
                      {...a}
                      value={adjReason}
                      disabled={pending}
                      placeholder="Agreed reduction"
                      onChange={(e) => setAdjReason(e.target.value)}
                    />
                  )}
                </Field>
                <div>
                  <SecondaryButton onClick={addAdj} disabled={pending} className="!px-2.5 !py-1 !text-[12px]">
                    Add adjustment
                  </SecondaryButton>
                </div>
              </div>
            )}
          </div>

          {stmt.status === "finalized" && stmt.finalizedAt && (
            <div className="text-[11.5px] mt-3" style={muted}>
              Finalized {formatInstant(new Date(stmt.finalizedAt), timeZone)}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
