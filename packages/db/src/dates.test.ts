import { describe, expect, it } from 'vitest';
import { addDays, dayLabel, daysBetween, isIsoDay, todayIn } from './dates';

describe('todayIn', () => {
  it('uses the U.S. Eastern date, not UTC', () => {
    // 11:30 p.m. EDT on Oct 31.
    expect(todayIn(undefined, new Date('2026-11-01T03:30:00Z'))).toBe('2026-10-31');
    expect(todayIn(undefined, new Date('2026-11-01T04:30:00Z'))).toBe('2026-11-01');
    // After clocks go back, midnight Eastern is 05:00 UTC.
    expect(todayIn(undefined, new Date('2026-11-02T04:59:00Z'))).toBe('2026-11-01');
  });
});

describe('addDays / daysBetween', () => {
  it('crosses months, years and DST changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-28', '2026-11-06')).toBe(9);
    expect(daysBetween('2026-11-06', '2026-10-28')).toBe(-9);
  });
});

describe('isIsoDay', () => {
  it('accepts real dates only', () => {
    expect(isIsoDay('2026-10-31')).toBe(true);
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('2026-02-29')).toBe(false);
    expect(isIsoDay('2026-02-31')).toBe(false);
    expect(isIsoDay('2026-13-01')).toBe(false);
    expect(isIsoDay('2026-1-01')).toBe(false);
    expect(isIsoDay('2026-10-31T00:00')).toBe(false);
  });
});

describe('dayLabel', () => {
  it('formats weekday and day of month', () => {
    expect(dayLabel('2026-10-25')).toBe('Sun 25');
  });
});
