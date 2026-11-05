// Runs every squad batch once, instead of waiting for the hourly job to rotate
// through them. For the first import, locally or right after the first deploy.
//   npm run squads:import                                  (uses DATABASE_URL from .env)
//   DATABASE_URL="<production url>" FOOTBALL_DATA_TOKEN="<token>" npx tsx jobs/scripts/import-squads.ts
import { createDb, finishJobRun, startJobRun } from '@usnt/db';
import { footballData } from '../src/providers/football-data';
import { syncSquads } from '../src/tasks/sync-squads';

// football-data.org's free tier allows 10 calls a minute; this stays well under.
const PAUSE_MS = 7_000;

const sql = createDb(process.env.DATABASE_URL);
const provider = footballData(process.env.FOOTBALL_DATA_TOKEN ?? '');
let failed = 0;

for (let batch = 0; batch < provider.squadBatchCount; batch++) {
  if (batch > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  const id = await startJobRun(sql, 'sync-squads');
  try {
    const result = await syncSquads(sql, provider, batch);
    await finishJobRun(sql, id, true, result.calls, result.detail);
    console.log(result.detail);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(sql, id, false, 0, message.slice(0, 1000));
    console.error(`Batch ${batch} failed: ${message}`);
  }
}

if (failed > 0) {
  console.error(`${failed} of ${provider.squadBatchCount} batches failed. Rerun to retry; imports are idempotent.`);
  process.exit(1);
}
