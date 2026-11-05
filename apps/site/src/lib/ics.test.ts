import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeText, foldLine } from './ics';

const encoder = new TextEncoder();

describe('foldLine', () => {
  it('keeps every physical line within 75 octets without splitting characters', () => {
    const line = `SUMMARY:${'Atlético Mineiro vs São Paulo — ⚽ '.repeat(6)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    // Unfolding (remove CRLF + one space) gives back the original.
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('leaves short lines alone', () => {
    expect(foldLine('BEGIN:VEVENT')).toBe('BEGIN:VEVENT');
  });
});

describe('escapeText', () => {
  it('escapes TEXT special characters', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\;c\\\\d\\ne');
  });
});

describe('buildCalendar', () => {
  const event = {
    uid: 'match-1-x@usnt.today',
    start: new Date('2026-11-01T03:30:00Z'),
    durationMinutes: 120,
    summary: 'Home vs Away',
    description: 'Premier League',
    url: 'https://usnt.today/player/x',
  };

  it('writes timed events in UTC', () => {
    const ics = buildCalendar('X matches', [{ ...event, timed: true }], new Date('2026-10-31T12:00:00Z'));
    expect(ics).toContain('DTSTART:20261101T033000Z\r\n');
    expect(ics).toContain('DTEND:20261101T053000Z\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('writes unconfirmed kickoffs as all-day events on the Eastern date', () => {
    const ics = buildCalendar('X matches', [{ ...event, timed: false }]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261031\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261101\r\n');
  });
});
