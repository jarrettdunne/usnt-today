// Minimal iCalendar (RFC 5545) writer for the player calendar feeds.
import { addDays, SITE_TZ, todayIn } from '@usnt/db';

export interface IcsEvent {
  uid: string;
  start: Date;
  /** False when only the date is known: written as an all-day event on the U.S. Eastern date. */
  timed: boolean;
  durationMinutes: number;
  summary: string;
  description: string;
  url: string;
}

/** 20261031T190000Z */
function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 20261031 */
function dateStamp(day: string): string {
  return day.replace(/-/g, '');
}

/** Escapes TEXT values: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line to at most 75 octets per line (RFC 5545 section 3.1),
 * continuing with CRLF + space and never splitting a multi-byte character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75.
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildCalendar(name: string, events: IcsEvent[], now: Date = new Date()): string {
  const stamp = utcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//usnt.today//schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const e of events) {
    const timing = e.timed
      ? [
          `DTSTART:${utcStamp(e.start)}`,
          `DTEND:${utcStamp(new Date(e.start.getTime() + e.durationMinutes * 60_000))}`,
        ]
      : (() => {
          const day = todayIn(SITE_TZ, e.start);
          return [`DTSTART;VALUE=DATE:${dateStamp(day)}`, `DTEND;VALUE=DATE:${dateStamp(addDays(day, 1))}`];
        })();
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      ...timing,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      `URL:${e.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
