// Days are grouped in U.S. Eastern time; pages show kickoff times in each
// visitor's local time on top of that.
export const SITE_TZ = 'America/New_York';

/** Today's date as YYYY-MM-DD in the given time zone. */
export function todayIn(tz: string = SITE_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Adds n days to a YYYY-MM-DD date. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-31, which Date rolls over). */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** "Sun 25" for 2026-10-25. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d);
  return `${weekday} ${d.getUTCDate()}`;
}
