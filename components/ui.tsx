import { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Shared button styling.
 *
 * Disabled is a real visual state, not just an attribute: an administrator
 * must be able to see that a submission is already in flight, otherwise the
 * only feedback for a slow save is silence and they click again.
 */
const buttonBase =
  "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[10px] text-[13.5px] font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "focus-visible:ring-[var(--brass)] focus-visible:ring-offset-[var(--surface)] " +
  "disabled:cursor-not-allowed";

function disabledStyle(disabled: boolean | undefined) {
  return disabled ? { opacity: 0.55 } : undefined;
}

export function PrimaryButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>
) {
  const { className = "", style, ...rest } = props;
  return (
    <button
      {...rest}
      className={`${buttonBase} text-white ${className}`}
      style={{ background: "var(--brand)", ...disabledStyle(rest.disabled), ...style }}
    />
  );
}

export function SecondaryButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>
) {
  const { className = "", style, ...rest } = props;
  return (
    <button
      {...rest}
      className={`${buttonBase} ${className}`}
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        color: "var(--ink)",
        ...disabledStyle(rest.disabled),
        ...style,
      }}
    />
  );
}

export function DangerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", style, ...rest } = props;
  return (
    <button
      {...rest}
      className={`${buttonBase} text-white ${className}`}
      style={{ background: "var(--danger)", ...disabledStyle(rest.disabled), ...style }}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[14px] p-5 ${className}`}
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {children}
    </div>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-display text-[28px] font-bold tracking-[-0.01em]" style={{ color: "var(--navy)" }}>
      {children}
    </h1>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      className="font-display text-[17px] font-semibold mb-3"
      style={{ color: "var(--ink)" }}
    >
      {children}
    </h2>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: "neutral" | "teal" | "rust" | "brass" | "coral";
  children: ReactNode;
}) {
  const toneStyles: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: "var(--line-soft)", fg: "var(--steel)" },
    teal: { bg: "var(--teal-soft)", fg: "var(--teal)" },
    rust: { bg: "var(--rust-soft)", fg: "#8a5a12" },
    brass: { bg: "var(--brass-soft)", fg: "var(--brass)" },
    coral: { bg: "var(--coral-soft)", fg: "var(--coral)" },
  };
  const s = toneStyles[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="rounded-[14px] p-10 text-center"
      style={{ border: "1px dashed var(--line)", background: "var(--card)" }}
    >
      <div className="font-display text-[16px] mb-1" style={{ color: "var(--ink)" }}>
        {title}
      </div>
      {description && (
        <div className="text-[13px] mb-4" style={{ color: "var(--steel)" }}>
          {description}
        </div>
      )}
      {action}
    </div>
  );
}

export function KpiCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note?: string;
  tone: "rust" | "teal" | "neutral";
}) {
  const color = tone === "rust" ? "var(--rust)" : tone === "teal" ? "var(--teal)" : "var(--ink)";
  const bg = tone === "rust" ? "var(--rust-soft)" : tone === "teal" ? "var(--teal-soft)" : "var(--line-soft)";
  return (
    <Card>
      <div
        className="w-8 h-8 rounded-[9px] flex items-center justify-center mb-3"
        style={{ background: bg, color }}
      >
        {icon}
      </div>
      <div className="text-[11.5px] mb-1" style={{ color: "var(--steel)" }}>
        {label}
      </div>
      <div className="num text-[26px] font-semibold" style={{ color }}>
        {value}
      </div>
      {note && (
        <div className="text-[11.5px] mt-1" style={{ color: "var(--steel)" }}>
          {note}
        </div>
      )}
    </Card>
  );
}
