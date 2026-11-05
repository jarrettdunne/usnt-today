// Applies every .sql file in ../migrations that hasn't run yet, in name order.
// Usage (from the repo root): npm run db:migrate
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const url = process.env.DATABASE_URL;

if (!url || url.includes('USER:PASSWORD')) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await readFile(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`Applying ${file}... `);
    await client.query('begin');
    try {
      await client.query(text);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log('done');
    } catch (err) {
      await client.query('rollback');
      console.log('failed');
      throw err;
    }
  }
  console.log('Database is up to date.');
} finally {
  await client.end();
}
