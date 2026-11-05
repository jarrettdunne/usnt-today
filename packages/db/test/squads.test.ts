import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/client';
import { upsertProviderSquads } from '../src/ingest';
import type { ProviderPlayer, ProviderTeam } from '../src/types';
import { createTestDb } from './pglite-sql';

const P = 'football_data';
const A: ProviderTeam = { externalId: '10', name: 'Club A', shortName: 'A' };
const B: ProviderTeam = { externalId: '20', name: 'Club B', shortName: 'B' };
const C: ProviderTeam = { externalId: '30', name: 'Club C', shortName: 'C' };

function player(id: string, name: string, team: ProviderTeam, overrides: Partial<ProviderPlayer> = {}): ProviderPlayer {
  return {
    externalId: id,
    name,
    pool: 'men',
    position: 'MF',
    birthDate: '1998-12-18',
    eligibilitySource: 'Nationality listed as USA by football-data.org',
    team,
    ...overrides,
  };
}

let db: PGlite;
let sql: Sql;

beforeEach(async () => {
  ({ db, sql } = await createTestDb());
});

interface PlayerState {
  slug: string;
  name: string;
  player_group: string;
  added_by: string;
  club: string | null;
  position: string | null;
  eligibility_source: string | null;
}

async function players(): Promise<PlayerState[]> {
  return (
    await db.query<PlayerState>(
      `select p.slug, p.name, p.player_group, p.added_by, t.name as club, p.position, p.eligibility_source
       from players p left join teams t on t.id = p.current_team_id
       order by p.slug`,
    )
  ).rows;
}

async function clubOf(slug: string): Promise<string | null> {
  return (await players()).find((p) => p.slug === slug)?.club ?? null;
}

async function teamId(ext: string): Promise<number> {
  const r = await db.query<{ team_id: number }>(
    'select team_id from team_provider_ids where provider = $1 and external_id = $2',
    [P, ext],
  );
  return r.rows[0].team_id;
}

/**
 * Moves every squad fetch and sighting `days` into the past, as if the last sync ran
 * then. A later batch then shows what has (or hasn't) been fetched since.
 */
async function lastSyncDaysAgo(days: number): Promise<void> {
  await db.query(`update player_provider_ids set last_seen_at = last_seen_at - make_interval(days => $1)`, [days]);
  await db.query(`update team_provider_ids set squad_seen_at = squad_seen_at - make_interval(days => $1)`, [days]);
}

describe('upsertProviderSquads', () => {
  it('imports eligible players at their squad’s club, once', async () => {
    const batch = { teams: [A, B], players: [player('1', 'Some Player', A)] };
    await upsertProviderSquads(sql, P, batch);
    await upsertProviderSquads(sql, P, batch);

    expect(await players()).toEqual([
      {
        slug: 'some-player',
        name: 'Some Player',
        player_group: 'eligible',
        added_by: P,
        club: 'Club A',
        position: 'MF',
        eligibility_source: 'Nationality listed as USA by football-data.org',
      },
    ]);
    // Teams with no eligible players are still created, so they can be picked in the admin.
    expect((await db.query('select name from teams order by name')).rows).toEqual([
      { name: 'Club A' },
      { name: 'Club B' },
    ]);
  });

  it('does nothing for an empty batch', async () => {
    await upsertProviderSquads(sql, P, { teams: [], players: [] });
    expect((await db.query('select count(*)::int as n from teams')).rows).toEqual([{ n: 0 }]);
  });

  it('links an editor’s existing player by name and birth date, keeping their edits', async () => {
    await db.query(
      `insert into players (slug, name, pool, player_group, birth_date, position, eligibility_source)
       values ('some-player', 'Some Player', 'men', 'active', '1998-12-18', null, 'U.S. Soccer roster')`,
    );
    await upsertProviderSquads(sql, P, { teams: [A], players: [player('1', 'SOME PLAYER', A)] });

    expect(await players()).toEqual([
      {
        slug: 'some-player',
        name: 'Some Player',
        player_group: 'active',
        added_by: 'editor',
        club: 'Club A',
        position: 'MF', // was empty, so filled in
        eligibility_source: 'U.S. Soccer roster',
      },
    ]);
  });

  it('does not link a same-named player with a different birth date', async () => {
    await db.query(
      `insert into players (slug, name, pool, birth_date) values ('some-player', 'Some Player', 'men', '1990-01-01')`,
    );
    await upsertProviderSquads(sql, P, { teams: [A], players: [player('1', 'Some Player', A)] });
    expect((await players()).map((p) => p.slug)).toEqual(['some-player', 'some-player-1']);
  });

  it('gives same-named players in one batch distinct slugs', async () => {
    await upsertProviderSquads(sql, P, {
      teams: [A, B],
      players: [player('1', 'Same Name', A, { birthDate: '2000-01-01' }), player('2', 'Same Name', B, { birthDate: '2001-01-01' })],
    });
    expect((await players()).map((p) => p.slug)).toEqual(['same-name-1', 'same-name-2']);
  });

  it('follows club moves the provider reports', async () => {
    await upsertProviderSquads(sql, P, { teams: [A], players: [player('1', 'Some Player', A)] });
    await upsertProviderSquads(sql, P, { teams: [C], players: [player('1', 'Some Player', C)] });
    expect(await clubOf('some-player')).toBe('Club C');
  });

  it('keeps a club an editor set, until the provider agrees with it', async () => {
    await upsertProviderSquads(sql, P, { teams: [A, B, C], players: [player('1', 'Some Player', A)] });
    // The editor knows better: the player has moved to B.
    await db.query(`update players set current_team_id = $1`, [await teamId('20')]);

    await upsertProviderSquads(sql, P, { teams: [A], players: [player('1', 'Some Player', A)] });
    expect(await clubOf('some-player')).toBe('Club B');

    // The provider catches up, so the player is synced again and follows later moves.
    await upsertProviderSquads(sql, P, { teams: [B], players: [player('1', 'Some Player', B)] });
    await upsertProviderSquads(sql, P, { teams: [C], players: [player('1', 'Some Player', C)] });
    expect(await clubOf('some-player')).toBe('Club C');
  });

  describe('players who leave a squad', () => {
    beforeEach(async () => {
      await upsertProviderSquads(sql, P, { teams: [A], players: [player('1', 'Some Player', A)] });
    });

    it('keep their club while the absence is short', async () => {
      await lastSyncDaysAgo(1);
      await upsertProviderSquads(sql, P, { teams: [A], players: [] });
      expect(await clubOf('some-player')).toBe('Club A');
    });

    it('lose their club once their team’s squad has been refetched without them for the grace period', async () => {
      await lastSyncDaysAgo(3);
      await upsertProviderSquads(sql, P, { teams: [A], players: [] });
      expect(await clubOf('some-player')).toBeNull();
    });

    it('keep their club when only other teams were refetched (e.g. during an outage of their batch)', async () => {
      await lastSyncDaysAgo(3);
      await upsertProviderSquads(sql, P, { teams: [B], players: [] });
      expect(await clubOf('some-player')).toBe('Club A');
    });

    it('keep a club an editor set', async () => {
      await upsertProviderSquads(sql, P, { teams: [B], players: [] });
      await db.query(`update players set current_team_id = $1`, [await teamId('20')]);
      await lastSyncDaysAgo(3);
      await upsertProviderSquads(sql, P, { teams: [A, B], players: [] });
      expect(await clubOf('some-player')).toBe('Club B');
    });
  });
});
