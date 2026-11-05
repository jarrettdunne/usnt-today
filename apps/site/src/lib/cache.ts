import type { Pool } from '@usnt/db';

// Pages whose content depends only on the path and the pool. Anything else
// (forms, pages that read the query string) is never edge-cached.
const CACHEABLE_PATHS = [
  /^\/$/,
  /^\/about$/,
  /^\/transfers$/,
  /^\/player\/[a-z0-9-]+$/,
  /^\/calendar\/[a-z0-9-]+\.ics$/,
];

export function isCacheablePath(pathname: string): boolean {
  return CACHEABLE_PATHS.some((re) => re.test(pathname));
}

/**
 * One cache entry per page per pool. The query string is left out, so random
 * parameters (?x=1, ?x=2, ...) all share one entry instead of each reaching the database.
 */
export function cacheKey(url: URL, pool: Pool): Request {
  return new Request(`${url.origin}${url.pathname}?__pool=${pool}`);
}
