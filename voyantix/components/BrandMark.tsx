export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ color: "#E6A05A" }}
    >
      <path
        d="M3 18C7 18 6 8 11 8C15 8 14 15 19 15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="19" cy="15" r="2" fill="currentColor" />
    </svg>
  );
}
