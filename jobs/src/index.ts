import { addDays, createDb, finishJobRun, snapshotMetrics, startJobRun, todayIn, type Sql } from '@usnt/db';
import { footballData } from './providers/football-data';
import type { MatchProvider, SquadProvider } from './providers/types';
import { syncMatches } from './tasks/sync-matches';
import { squadBatchFor, syncSquads } from './tasks/sync-squads';

export interface JobsEnv {
  DATABASE_URL: string;
  FOOTBALL_DATA_TOKEN: string;
}

// Keep in sync with "triggers.crons" in wrangler.jsonc.
const DAILY = '0 10 * * *';
const RECENT = '*/30 * * * *';
// Hourly at :15, one competition's squads per run (10 competitions, so each about twice a day).
const SQUADS = '15 * * * *';

interface TaskResult {
  calls: number;
  detail: string;
}

/**
 * Records each job in job_runs so the admin dashboard can show health and API usage.
 * Returns the error (null on success) instead of throwing, so one failed task doesn't skip the next.
 */
async function run(sql: Sql, job: string, task: () => Promise<TaskResult>): Promise<Error | null> {
  const id = await startJobRun(sql, job);
  try {
    const result = await task();
    await finishJobRun(sql, id, true, result.calls, result.detail);
    return null;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await finishJobRun(sql, id, false, 0, error.message.slice(0, 1000));
    return error;
  }
}

export default {
  async scheduled(controller: ScheduledController, env: JobsEnv): Promise<void> {
    const sql = createDb(env.DATABASE_URL);
    // Swap this line to change data provider (e.g. API-Football in the Lite + live data tier).
    const provider: MatchProvider & SquadProvider = footballData(env.FOOTBALL_DATA_TOKEN);
    const today = todayIn();
    const results: (Error | null)[] = [];

    if (controller.cron === DAILY) {
      // football-data.org's free tier allows date ranges of up to 10 days.
      results.push(await run(sql, 'sync-window', () => syncMatches(sql, provider, addDays(today, -3), addDays(today, 6))));
      results.push(
        await run(sql, 'metrics', async () => {
          await snapshotMetrics(sql, today);
          return { calls: 0, detail: 'snapshot saved' };
        }),
      );
    } else if (controller.cron === RECENT) {
      // Picks up final scores (post-match summaries). No live data in Free lite.
      results.push(await run(sql, 'sync-recent', () => syncMatches(sql, provider, addDays(today, -1), today)));
    } else if (controller.cron === SQUADS) {
      // Free lite: imports players football-data.org lists as U.S. nationals.
      const batch = squadBatchFor(controller.scheduledTime, provider.squadBatchCount);
      results.push(await run(sql, 'sync-squads', () => syncSquads(sql, provider, batch)));
    } else {
      console.warn(`No job is set up for cron "${controller.cron}"`);
    }

    // Rethrow so the invocation shows as failed in Cloudflare's logs too.
    const failed = results.filter((e): e is Error => e !== null);
    if (failed.length === 1) throw failed[0];
    if (failed.length > 1) throw new AggregateError(failed, `${failed.length} jobs failed`);
  },
};
