import { describe, expect, it } from 'vitest';
import { cacheKey, isCacheablePath } from './cache';

describe('isCacheablePath', () => {
  it.each(['/', '/about', '/transfers', '/player/some-name', '/calendar/some-name.ics'])(
    'caches %s',
    (path) => expect(isCacheablePath(path)).toBe(true),
  );

  it.each(['/correction', '/date/2026-10-31', '/date/2026-10-31/x', '/player/', '/player/a/b', '/styles.css', '/date/x'])(
    'does not cache %s',
    (path) => expect(isCacheablePath(path)).toBe(false),
  );
});

describe('cacheKey', () => {
  it('ignores the query string but separates pools', () => {
    const a = cacheKey(new URL('https://usnt.today/player/some-name?x=1'), 'men');
    const b = cacheKey(new URL('https://usnt.today/player/some-name?x=2&pool=women'), 'men');
    const c = cacheKey(new URL('https://usnt.today/player/some-name'), 'women');
    expect(a.url).toBe(b.url);
    expect(a.url).not.toBe(c.url);
  });
});
