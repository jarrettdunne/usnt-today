import { upsertProviderMatches, type Sql } from '@usnt/db';
import type { MatchProvider } from '../providers/types';

/**
 * Fetches and stores matches from `from` to `to` (YYYY-MM-DD, inclusive). Matches
 * the provider no longer returns inside that window are flagged as missing.
 */
export async function syncMatches(
  sql: Sql,
  provider: MatchProvider,
  from: string,
  to: string,
): Promise<{ calls: number; detail: string }> {
  const { matches, calls } = await provider.fetchMatches(from, to);
  await upsertProviderMatches(sql, provider.key, matches, { from, to });
  return { calls, detail: `${matches.length} matches from ${from} to ${to}` };
}
