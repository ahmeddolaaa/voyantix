"use client";

import { useMemo, useRef, useState, useId } from "react";

/**
 * TIMEZONE COMBOBOX — domain-specific, deliberately not a generic Select.
 * ---------------------------------------------------------------------------
 * The suggestion list is a convenience, never a whitelist. Intl's own list
 * omits identifiers that are perfectly valid and in daily use: "UTC" is
 * absent, and so is "Asia/Kolkata" (the list carries the older
 * "Asia/Calcutta" instead). A picker restricted to that list would refuse
 * real ports.
 *
 * So anything the runtime can resolve is accepted, whether or not it appears
 * in the list. When the administrator types such a value, it is offered as
 * an explicit choice rather than silently rejected.
 *
 * The server re-validates and canonicalizes on save
 * (lib/master-data/timezone.ts) — that result is what gets stored, so this
 * component never has the last word on the value.
 * ---------------------------------------------------------------------------
 */

function resolveInBrowser(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // Fixed offsets carry no daylight-saving rule; the server rejects them
  // and so does this, to avoid offering a value that cannot be saved.
  if (/^[+\-\u2212]\d{1,2}(:?\d{2})?$/.test(trimmed)) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;
    return resolved || null;
  } catch {
    return null;
  }
}

function suggestionList(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return Array.from(new Set(["UTC", ...supported])).sort((a, b) =>
    a.localeCompare(b)
  );
}

/** Splits "Africa/Cairo" into a readable city and region for searching. */
function readable(tz: string): string {
  return tz.replace(/_/g, " ").replace(/\//g, " / ");
}

export function TimezoneCombobox({
  value,
  onChange,
  id,
  required,
  disabled,
  invalid,
  "aria-describedby": describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  "aria-describedby"?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const listId = `${generatedId}-listbox`;
  const controlId = id ?? generatedId;

  const all = useMemo(suggestionList, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return all.slice(0, 50);
    const found = all
      .filter(
        (tz) =>
          tz.toLowerCase().includes(q) || readable(tz).toLowerCase().includes(q)
      )
      .slice(0, 50);

    // A runtime-valid identifier absent from the list is offered explicitly
    // rather than hidden — see the file header.
    const resolved = resolveInBrowser(query);
    if (resolved && !found.some((tz) => tz.toLowerCase() === q)) {
      return [resolved, ...found.filter((tz) => tz !== resolved)].slice(0, 50);
    }
    return found;
  }, [query, all]);

  function commit(tz: string) {
    onChange(tz);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const choice = matches[activeIndex];
      if (choice) commit(choice);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  const controlStyle = {
    background: disabled ? "var(--line-soft)" : "var(--card)",
    border: `1px solid ${invalid ? "var(--rust)" : "var(--line)"}`,
    color: "var(--ink)",
  };

  return (
    <div className="relative">
      {/* Selected value, shown as a settled choice rather than editable text
          so the stored identifier is always exactly what was chosen. */}
      {value && !open ? (
        <div
          className="flex items-center justify-between w-full px-3 py-2 rounded-md text-[13px]"
          style={controlStyle}
        >
          <span className="num">{value}</span>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setQuery("");
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
            disabled={disabled}
            className="text-[12px] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)] rounded-sm"
            style={{ color: "var(--brass)" }}
          >
            Change
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          id={controlId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required && !value}
          disabled={disabled}
          placeholder="Search, for example Cairo or Africa/Cairo"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          className="w-full px-3 py-2 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]"
          style={controlStyle}
        />
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md"
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            boxShadow: "0 10px 28px rgba(19,38,44,.12)",
          }}
        >
          {matches.length === 0 ? (
            <li
              className="px-3 py-2 text-[12.5px]"
              style={{ color: "var(--steel)" }}
            >
              No timezone matches that search.
            </li>
          ) : (
            matches.map((tz, i) => (
              <li key={tz} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  // onMouseDown fires before the input's blur, so the click
                  // is not lost to the list closing first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(tz);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className="w-full text-left px-3 py-2 text-[12.5px] num"
                  style={{
                    background:
                      i === activeIndex ? "var(--brass-soft)" : "transparent",
                    color: "var(--ink)",
                  }}
                >
                  {tz}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
