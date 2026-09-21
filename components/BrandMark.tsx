export function BrandMark({ size = 24 }: { size?: number }) {
  // A crisp gold "V" chevron — the restrained brand accent.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ color: "var(--gold)" }}
      aria-hidden
    >
      <path
        d="M4.5 5.5 L12 18.5 L19.5 5.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
