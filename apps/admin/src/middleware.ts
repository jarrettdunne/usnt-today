// Every admin request must carry a valid Cloudflare Access token.
// Locally, ADMIN_DEV_BYPASS="true" in .dev.vars skips the check.
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const vars = env as unknown as Record<string, string | undefined>;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function forbidden(): Response {
  return new Response('Forbidden. Sign in through Cloudflare Access.', { status: 403 });
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (vars.ADMIN_DEV_BYPASS === 'true') return next();

  const teamDomain = vars.ACCESS_TEAM_DOMAIN;
  const audience = vars.ACCESS_AUD;
  const token = context.request.headers.get('cf-access-jwt-assertion');
  if (!teamDomain || !audience || !token) return forbidden();

  jwks ??= createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  try {
    await jwtVerify(token, jwks, { issuer: `https://${teamDomain}`, audience });
  } catch {
    return forbidden();
  }
  return next();
});
