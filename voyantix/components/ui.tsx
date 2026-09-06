import { ButtonHTMLAttributes, ReactNode } from "react";

export function PrimaryButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>
) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`px-4 py-2 rounded-md text-[13px] font-medium text-white transition-colors ${className}`}
      style={{ background: "var(--brass)" }}
    />
  );
}

export function SecondaryButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>
) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`px-4 py-2 rounded-md text-[13px] font-medium transition-colors ${className}`}
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        color: "var(--ink)",
      }}
    />
  );
}

export function DangerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`px-4 py-2 rounded-md text-[13px] font-medium text-white transition-colors ${className}`}
      style={{ background: "var(--rust)" }}
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
      className={`rounded-lg p-5 ${className}`}
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        boxShadow: "0 1px 2px rgba(19,38,44,.05), 0 10px 28px rgba(19,38,44,.07)",
      }}
    >
      {children}
    </div>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-display text-[22px] font-medium" style={{ color: "var(--ink)" }}>
      {children}
    </h1>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      className="font-display text-[15px] font-medium mb-3"
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
  tone: "neutral" | "teal" | "rust" | "brass";
  children: ReactNode;
}) {
  const toneStyles: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: "var(--line-soft)", fg: "var(--steel)" },
    teal: { bg: "var(--teal-soft)", fg: "var(--teal)" },
    rust: { bg: "var(--rust-soft)", fg: "var(--rust)" },
    brass: { bg: "var(--brass-soft)", fg: "var(--brass)" },
  };
  const s = toneStyles[tone];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium"
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
      className="rounded-lg p-10 text-center"
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
        className="w-7 h-7 rounded-md flex items-center justify-center mb-3"
        style={{ background: bg, color }}
      >
        {icon}
      </div>
      <div className="text-[11.5px] mb-1" style={{ color: "var(--steel)" }}>
        {label}
      </div>
      <div className="num text-[22px] font-medium" style={{ color }}>
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
