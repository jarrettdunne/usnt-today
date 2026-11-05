import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// One HTTP request per query (or per transaction), which suits Workers:
// no connection pool to manage, and each query counts as one subrequest.
export type Sql = NeonQueryFunction<false, false>;

export function createDb(databaseUrl: string | undefined): Sql {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return neon(databaseUrl);
}
