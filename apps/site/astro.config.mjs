// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  // Every page is rendered on request so schedules are always current.
  output: 'server',
  // No image transforms yet (basic HTML first), so no Images binding is needed.
  adapter: cloudflare({ imageService: 'passthrough' }),
  server: { port: 4321 },
  // Fetch a page as soon as a link to it is hovered or focused, so the click
  // feels instant. Links that set a cookie or download a file opt out with
  // data-astro-prefetch="false".
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
});
