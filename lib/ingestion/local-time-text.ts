/**
 * SOF local times are stored as "YYYY-MM-DDTHH:mm" (no zone) but shown to the
 * analyst as they appear on a statement of facts: "23/06/2026 00:01".
 * Pure; safe for client components.
 */

/** "2026-06-23T00:01" → "23/06/2026 00:01" ("" stays ""; unknown shapes pass through). */
export function localToDisplay(local: string | null | undefined): string {
  if (!local) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return local;
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

/**
 * "23/06/2026 00:01" (also "23/06/2026 0001", "23-06-2026 00:01") →
 * "2026-06-23T00:01". Returns null when it is not a real date/time.
 */
export function displayToLocal(text: string): string | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s+(\d{1,2}):?(\d{2})\s*$/.exec(text);
  if (!m) return null;
  const [day, month, year, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}`;
}
