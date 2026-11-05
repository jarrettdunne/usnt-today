import { describe, expect, it } from 'vitest';
import { squadBatchFor } from './sync-squads';

describe('squadBatchFor', () => {
  it('moves to the next batch each hour and covers every batch', () => {
    const start = Date.parse('2026-10-31T00:15:00Z');
    const batches = Array.from({ length: 24 }, (_, h) => squadBatchFor(start + h * 3_600_000, 10));
    expect(new Set(batches).size).toBe(10);
    for (let h = 1; h < 24; h++) expect(batches[h]).toBe((batches[h - 1] + 1) % 10);
  });
});
