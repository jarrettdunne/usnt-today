import { env } from 'cloudflare:workers';

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * True if this visitor may submit the corrections form now (3 a minute, set in
 * wrangler.jsonc). Allows the request when the binding or the visitor's IP is
 * missing; the hourly cap in insertCorrection is the backstop.
 */
export async function allowCorrection(request: Request): Promise<boolean> {
  const limiter = (env as unknown as { CORRECTIONS_LIMITER?: RateLimiter }).CORRECTIONS_LIMITER;
  const ip = request.headers.get('cf-connecting-ip');
  if (!limiter || !ip) return true;
  const { success } = await limiter.limit({ key: ip });
  return success;
}
