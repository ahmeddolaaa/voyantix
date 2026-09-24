/**
 * Voyantix mark: a brass tile carrying a white "V" chevron with a faint
 * horizon line — the same mark in the sidebar, sign-in and statement
 * letterhead.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--brass)" />
      <path
        d="M8 9l8 15 8-15"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11.5 9h9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}
