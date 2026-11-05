import { upsertProviderSquads, type Sql } from '@usnt/db';
import type { SquadProvider } from '../providers/types';

/** The batch for a run: rotates through every batch, one per hour. */
export function squadBatchFor(scheduledTime: number, batchCount: number): number {
  return Math.floor(scheduledTime / 3_600_000) % batchCount;
}

/** Imports one batch of squads (in Free lite, one competition's teams). */
export async function syncSquads(
  sql: Sql,
  provider: SquadProvider,
  batch: number,
): Promise<{ calls: number; detail: string }> {
  const { teams, players, calls, label } = await provider.fetchSquads(batch);
  await upsertProviderSquads(sql, provider.key, { teams, players });
  return { calls, detail: `${label}: ${teams.length} teams, ${players.length} eligible players` };
}
