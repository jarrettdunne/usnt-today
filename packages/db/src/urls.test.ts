import { describe, expect, it } from 'vitest';
import { isHttpUrl, safeHref } from './urls';

describe('isHttpUrl', () => {
  it.each(['https://example.com', 'http://example.com/a?b=c', 'HTTPS://EXAMPLE.COM'])('accepts %s', (url) => {
    expect(isHttpUrl(url)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//example.com',
    '/relative',
    'https://',
    'example.com',
    '',
  ])('rejects %j', (url) => {
    expect(isHttpUrl(url)).toBe(false);
  });
});

describe('safeHref', () => {
  it('returns null for unsafe or missing values', () => {
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('https://example.com')).toBe('https://example.com');
  });
});
