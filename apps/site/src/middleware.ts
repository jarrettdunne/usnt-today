import { defineMiddleware } from 'astro:middleware';
import type { Pool } from '@usnt/db';
import { cacheKey, isCacheablePath } from './lib/cache';

const POOL_COOKIE = 'pool';
const ONE_YEAR = 60 * 60 * 24 * 365;
// Edge cache lifetime for public pages, which keeps the free Neon database
// from being queried on every visit.
const EDGE_CACHE_SECONDS = 300;

function readPool(url: URL, cookie: string | undefined): { pool: Pool; fromParam: boolean } {
  const param = url.searchParams.get('pool');
  if (param === 'men' || param === 'women') return { pool: param, fromParam: true };
  if (cookie === 'men' || cookie === 'women') return { pool: cookie, fromParam: false };
  return { pool: 'men', fromParam: false };
}

/** A copy of `response` (body untouched) with Cache-Control replaced. */
function withCacheControl(response: Response, value: string): Response {
  const copy = new Response(response.body, response);
  copy.headers.set('Cache-Control', value);
  return copy;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pool, fromParam } = readPool(context.url, context.cookies.get(POOL_COOKIE)?.value);
  context.locals.pool = pool;
  if (fromParam) {
    // The browser remembers the last Men/Women choice.
    context.cookies.set(POOL_COOKIE, pool, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax', secure: !import.meta.env.DEV });
  }

  const edgeCache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheable =
    edgeCache &&
    !import.meta.env.DEV &&
    !fromParam &&
    context.request.method === 'GET' &&
    isCacheablePath(context.url.pathname);
  if (!cacheable) return next();

  const key = cacheKey(context.url, pool);
  const hit = await edgeCache.match(key);
  // Browsers revalidate, so switching Men/Women never shows a stale page.
  if (hit) return withCacheControl(hit, 'no-cache');

  const response = await next();
  if (response.status !== 200 || response.headers.has('set-cookie')) return response;

  const cached = withCacheControl(response, `public, max-age=${EDGE_CACHE_SECONDS}`);
  await edgeCache.put(key, cached.clone());
  return withCacheControl(cached, 'no-cache');
});
