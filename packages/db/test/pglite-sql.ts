// Test stand-in for the Neon `sql` function, backed by PGlite (Postgres in WASM).
// Supports what the query modules use: tagged templates, nested fragments and
// sql.transaction([...]).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Sql } from '../src/client';

type Runner = Pick<PGlite | Transaction, 'query'>;

class Query implements PromiseLike<Record<string, unknown>[]> {
  constructor(
    readonly runner: () => Runner,
    readonly strings: readonly string[],
    readonly values: unknown[],
  ) {}

  /** Flattens nested fragments into one query with $1, $2, ... placeholders. */
  compile(params: unknown[] = []): string {
    let text = this.strings[0];
    this.values.forEach((value, i) => {
      if (value instanceof Query) {
        text += value.compile(params);
      } else {
        params.push(value);
        text += `$${params.length}`;
      }
      text += this.strings[i + 1];
    });
    return text;
  }

  async run(runner: Runner): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [];
    const text = this.compile(params);
    return (await runner.query<Record<string, unknown>>(text, params)).rows;
  }

  then<A = Record<string, unknown>[], B = never>(
    onFulfilled?: ((rows: Record<string, unknown>[]) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run(this.runner()).then(onFulfilled, onRejected);
  }
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** A fresh database with every migration applied, plus a Neon-shaped `sql` for it. */
export async function createTestDb(): Promise<{ db: PGlite; sql: Sql }> {
  const db = new PGlite();
  // Neon's default; queries must not depend on the session time zone anyway.
  await db.exec(`set timezone = 'UTC'`);
  for (const file of (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(path.join(migrationsDir, file), 'utf8'));
  }

  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => new Query(() => db, strings, values);
  const transaction = (queries: Query[]) =>
    db.transaction(async (tx) => {
      const results: Record<string, unknown>[][] = [];
      for (const q of queries) results.push(await q.run(tx));
      return results;
    });
  return { db, sql: Object.assign(tag, { transaction }) as unknown as Sql };
}
