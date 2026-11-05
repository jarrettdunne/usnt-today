import { describe, expect, it } from 'vitest';
import { longDayLabel, weekRange } from './week';

describe('weekRange', () => {
  it('covers today and the next 6 days, across a month end', () => {
    expect(weekRange('2026-10-29')).toEqual({ first: '2026-10-29', last: '2026-11-04' });
  });
});

describe('longDayLabel', () => {
  it('spells out the weekday and month', () => {
    expect(longDayLabel('2026-11-02')).toBe('Monday, November 2');
  });
});
