// Copies DATABASE_URL and FOOTBALL_DATA_TOKEN from the root .env into each
// Worker's .dev.vars file, which wrangler and astro dev read locally.
import { writeFile } from 'node:fs/promises';

const { DATABASE_URL, FOOTBALL_DATA_TOKEN = '' } = process.env;

if (!DATABASE_URL || DATABASE_URL.includes('USER:PASSWORD')) {
  console.error('Add your Neon DATABASE_URL to .env first (see .env.example).');
  process.exit(1);
}

const files = {
  'apps/site/.dev.vars': `DATABASE_URL="${DATABASE_URL}"\n`,
  'apps/admin/.dev.vars': `DATABASE_URL="${DATABASE_URL}"\nADMIN_DEV_BYPASS="true"\n`,
  'jobs/.dev.vars': `DATABASE_URL="${DATABASE_URL}"\nFOOTBALL_DATA_TOKEN="${FOOTBALL_DATA_TOKEN}"\n`,
};

for (const [file, body] of Object.entries(files)) {
  await writeFile(new URL(`../${file}`, import.meta.url), body);
  console.log(`Wrote ${file}`);
}

if (!FOOTBALL_DATA_TOKEN) {
  console.warn('FOOTBALL_DATA_TOKEN is empty, so the jobs Worker cannot fetch matches yet.');
}
