import { describe, expect, it } from 'vitest';
import { slugify } from './slugs';

describe('slugify', () => {
  it('strips accents and punctuation', () => {
    expect(slugify('  Sergiño Dest! ')).toBe('sergino-dest');
    expect(slugify('***')).toBe('');
    expect(slugify('a'.repeat(99) + ' bc').length).toBeLessThanOrEqual(100);
    expect(slugify('a'.repeat(99) + ' bc').endsWith('-')).toBe(false);
  });
});
