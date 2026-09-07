"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { PrimaryButton } from "./ui";

/**
 * SHARED FORM PRIMITIVES
 * ---------------------------------------------------------------------------
 * Presentation and interaction only. These components hold no domain rules,
 * no validation logic, no server calls and no knowledge of ports, vessels or
 * cargo. They render what they are given.
 *
 * Validation lives on the server (lib/actions/*), which stays authoritative;
 * these components display its results.
 * ---------------------------------------------------------------------------
 */

/** Props a Field hands to whichever control it wraps. */
export type FieldControlProps = {
  id: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Labelled form field.
 *
 * The label/description/error are wired to the control by generated ids
 * rather than left to each caller to repeat, because a mismatched htmlFor is
 * invisible on screen and only shows up for someone using a screen reader.
 *
 * Pass children as a function to receive the wiring props:
 *
 *   <Field label="Port name" required error={err}>
 *     {(a) => <TextInput {...a} value={v} onChange={...} />}
 *   </Field>
 */
export function Field({
  label,
  required,
  description,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  description?: string;
  error?: string;
  children: ReactNode | ((props: FieldControlProps) => ReactNode);
}) {
  const id = useId();
  const describedBy = [
    description ? `${id}-description` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const controlProps: FieldControlProps = {
    id,
    required,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : undefined,
  };

  return (
    <div className="mb-4">
      <label
        htmlFor={id}
        className="block text-[12.5px] font-medium mb-1.5"
        style={{ color: "var(--ink-soft)" }}
      >
        {label}
        {required && (
          <span style={{ color: "var(--rust)" }} aria-hidden="true">
            {" *"}
          </span>
        )}
      </label>

      {description && (
        <p
          id={`${id}-description`}
          className="text-[11.5px] mb-1.5"
          style={{ color: "var(--steel)" }}
        >
          {description}
        </p>
      )}

      {typeof children === "function" ? children(controlProps) : children}

      {error && (
        <p
          id={`${id}-error`}
          className="text-[11.5px] mt-1.5"
          style={{ color: "var(--rust)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

const controlBase =
  "w-full px-3 py-2 rounded-md text-[13px] transition-colors " +
  "focus:outline-none focus:ring-2 focus:ring-offset-0 " +
  "disabled:cursor-not-allowed";

function controlStyle(invalid?: boolean, disabled?: boolean) {
  return {
    background: disabled ? "var(--line-soft)" : "var(--card)",
    border: `1px solid ${invalid ? "var(--rust)" : "var(--line)"}`,
    color: "var(--ink)",
    opacity: disabled ? 0.7 : 1,
  };
}

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function TextInput({ invalid, className = "", style, ...rest }, ref) {
  return (
    <input
      {...rest}
      ref={ref}
      className={`${controlBase} focus:ring-[var(--brass)] ${className}`}
      style={{ ...controlStyle(invalid ?? rest["aria-invalid"] === true, rest.disabled), ...style }}
    />
  );
});

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/**
 * Native select. Kept native deliberately — the browser's own keyboard
 * handling, type-ahead and mobile pickers are better than anything worth
 * rebuilding here, and this is a plain single choice.
 */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & {
    invalid?: boolean;
    placeholder?: string;
    options?: SelectOption[];
  }
>(function Select(
  { invalid, placeholder, options, className = "", style, children, ...rest },
  ref
) {
  return (
    <select
      {...rest}
      ref={ref}
      className={`${controlBase} focus:ring-[var(--brass)] ${className}`}
      style={{ ...controlStyle(invalid ?? rest["aria-invalid"] === true, rest.disabled), ...style }}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
});

/**
 * Form-level error banner, for failures that belong to the whole submission
 * rather than one field — a duplicate name, a permission gap, a record that
 * disappeared.
 *
 * role="alert" so it is announced when it appears after a save attempt.
 */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md px-3 py-2 mb-4 text-[12.5px]"
      style={{
        background: "var(--rust-soft)",
        border: "1px solid var(--rust)",
        color: "var(--rust)",
      }}
    >
      {message}
    </div>
  );
}

/**
 * Submit button that reflects in-flight state.
 *
 * `pending` is supplied by the page (from useTransition), not discovered
 * here: keeping server-action mechanics out of the shared control means the
 * same button works for a form action, a transition or a plain handler.
 */
export function SubmitButton({
  pending,
  children,
  pendingLabel,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel?: string;
}) {
  return (
    <PrimaryButton {...rest} disabled={pending || rest.disabled} aria-busy={pending}>
      {pending ? pendingLabel ?? "Saving…" : children}
    </PrimaryButton>
  );
}
