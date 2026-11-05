import type { ProviderMatch, ProviderSquads } from '@usnt/db';

export interface ProviderResult {
  matches: ProviderMatch[];
  /** API calls used, recorded in job_runs for the admin dashboard. */
  calls: number;
}

/** Every data provider implements this, so jobs and the database never change when switching. */
export interface MatchProvider {
  /** Stored in *_provider_ids tables, e.g. "football_data". */
  key: string;
  /** Matches with kickoff dates from `from` to `to` (YYYY-MM-DD, inclusive). */
  fetchMatches(from: string, to: string): Promise<ProviderResult>;
}

export interface SquadResult extends ProviderSquads {
  calls: number;
  /** What the batch covered, for job_runs (e.g. a competition code). */
  label: string;
}

/**
 * A provider that lists club squads and decides who counts as U.S.-eligible. Each
 * provider owns that rule: the free tier goes by listed nationality alone, and a
 * paid provider can apply something stricter without the job or database changing.
 */
export interface SquadProvider {
  key: string;
  /** Squads are fetched in this many batches, one per job run, to stay inside rate limits. */
  squadBatchCount: number;
  /** Batch `index` (0 to squadBatchCount - 1): every team's squad, with the eligible players. */
  fetchSquads(index: number): Promise<SquadResult>;
}
