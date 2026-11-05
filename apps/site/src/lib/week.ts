import { addDays, todayIn } from '@usnt/db';

/** Days on the week page: today and the 6 after it, as far ahead as the daily sync fetches. */
export const WEEK_DAYS = 7;

/** First and last U.S. Eastern day (YYYY-MM-DD) on the week page. */
export function weekRange(today = todayIn()): { first: string; last: string } {
  return { first: today, last: addDays(today, WEEK_DAYS - 1) };
}

/** "Monday, November 2" for a YYYY-MM-DD day. */
export function longDayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}
