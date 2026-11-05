import { env } from 'cloudflare:workers';
import { createDb, type Sql } from '@usnt/db';

export function getDb(): Sql {
  return createDb((env as unknown as { DATABASE_URL?: string }).DATABASE_URL);
}
