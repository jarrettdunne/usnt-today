import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/client';
import { getDashboard } from '../src/admin';
import { snapshotMetrics, upsertProviderMatches } from '../src/ingest';
import { getDayCounts, getMatchesBetween, getUpcomingTeamMatches, insertCorrection } from '../src/site';
import type { ProviderMatch } from '../src/types';
import { createTestDb } from './pglite-sql';

const P = 'football_data';

function match(id: string, kickoffUtc: string, overrides: Partial<ProviderMatch> = {}): ProviderMatch {
  return {
    externalId: id,
    competitionCode: 'PL',
    kickoffUtc,
    kickoffConfirmed: true,
    status: 'scheduled',
    home: { externalId: 'h1', name: 'Home FC', shortName: 'Home' },
    away: { externalId: 'a1', name: 'Away FC', shortName: 'Away' },
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

let db: PGlite;
let sql: Sql;

beforeEach(async () => {
  ({ db, sql } = await createTestDb());
});

async function rows<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(text, params)).rows;
}

/** Adds a men's player at the team the provider calls `teamExt`. */
async function addPlayer(slug: string, teamExt: string, pool = 'men'): Promise<void> {
  await db.query(
    `insert into players (slug, name, pool, current_team_id)
     select $1, $1, $2, team_id from team_provider_ids where provider = $3 and external_id = $4`,
    [slug, pool, P, teamExt],
  );
}

describe('upsertProviderMatches', () => {
  it('creates teams, mappings and matches, and is idempotent', async () => {
    const m = match('100', '2026-10-31T19:00:00Z');
    await upsertProviderMatches(sql, P, [m]);
    await upsertProviderMatches(sql, P, [m]);

    expect(await rows('select name from teams order by name')).toEqual([{ name: 'Away FC' }, { name: 'Home FC' }]);
    const [stored] = await rows<{ source_key: string; competition: string; kickoff_confirmed: boolean }>(
      `select m.source_key, c.name as competition, m.kickoff_confirmed
       from matches m join competitions c on c.id = m.competition_id`,
    );
    expect(stored).toEqual({ source_key: 'football_data:100', competition: 'Premier League', kickoff_confirmed: true });
  });

  it('refreshes names of teams this provider created', async () => {
    await upsertProviderMatches(sql, P, [match('100', '2026-10-31T19:00:00Z')]);
    await upsertProviderMatches(sql, P, [
      match('100', '2026-10-31T19:00:00Z', { home: { externalId: 'h1', name: 'Home AFC', shortName: 'HAFC' } }),
    ]);
    expect(await rows(`select name, short_name from teams where source_key = 'football_data:h1'`)).toEqual([
      { name: 'Home AFC', short_name: 'HAFC' },
    ]);
    expect(await rows('select count(*)::int as n from teams')).toEqual([{ n: 2 }]);
  });

  it('leaves the name of a team another provider created and this one is mapped to', async () => {
    const [{ id }] = await rows<{ id: number }>(
      `insert into teams (source_key, name) values ('api_football:9', 'Home Football Club') returning id`,
    );
    await db.query(`insert into team_provider_ids values ($1, 'h1', $2)`, [P, id]);

    await upsertProviderMatches(sql, P, [match('100', '2026-10-31T19:00:00Z')]);

    expect(await rows(`select name from teams where id = $1`, [id])).toEqual([{ name: 'Home Football Club' }]);
    expect(await rows(`select count(*)::int as n from teams where name = 'Home FC'`)).toEqual([{ n: 0 }]);
    const [m] = await rows<{ home_team_id: number }>('select home_team_id from matches');
    expect(m.home_team_id).toBe(id);
  });

  describe('missing matches', () => {
    const window = { from: '2026-10-28', to: '2026-11-06' };
    const keep = match('1', '2026-10-31T19:00:00Z');
    const moved = match('2', '2026-11-02T15:00:00Z');
    const edge = match('3', '2026-11-06T20:00:00Z'); // on the window's last day

    async function missing(): Promise<string[]> {
      const r = await rows<{ source_key: string }>(
        'select source_key from matches where missing_since is not null order by source_key',
      );
      return r.map((x) => x.source_key);
    }

    it('flags matches no longer returned inside the window, but not on its edge days', async () => {
      await upsertProviderMatches(sql, P, [keep, moved, edge], window);
      await upsertProviderMatches(sql, P, [keep], window);
      expect(await missing()).toEqual(['football_data:2']);
    });

    it('never flags finished matches', async () => {
      await upsertProviderMatches(sql, P, [keep, { ...moved, status: 'finished', homeScore: 1, awayScore: 0 }], window);
      await upsertProviderMatches(sql, P, [keep], window);
      expect(await missing()).toEqual([]);
    });

    it('treats an empty response as a hiccup and flags nothing', async () => {
      await upsertProviderMatches(sql, P, [keep, moved], window);
      await upsertProviderMatches(sql, P, [], window);
      expect(await missing()).toEqual([]);
    });

    it('flags nothing for a two-day window (the recent sync)', async () => {
      await upsertProviderMatches(sql, P, [keep, moved], window);
      await upsertProviderMatches(sql, P, [keep], { from: '2026-10-31', to: '2026-11-01' });
      expect(await missing()).toEqual([]);
    });

    it('clears the flag and moves the match when it is found again', async () => {
      await upsertProviderMatches(sql, P, [keep, moved], window);
      await upsertProviderMatches(sql, P, [keep], window);
      await upsertProviderMatches(sql, P, [{ ...moved, kickoffUtc: '2026-11-20T15:00:00Z' }]);
      expect(await missing()).toEqual([]);
      expect(await rows(`select kickoff_utc::text as k from matches where source_key = 'football_data:2'`)).toEqual([
        { k: '2026-11-20 15:00:00+00' },
      ]);
    });

    it('hides flagged matches from the site', async () => {
      await upsertProviderMatches(sql, P, [keep, moved], window);
      await addPlayer('some-player', 'h1');
      await upsertProviderMatches(sql, P, [keep], window);
      expect(await getMatchesBetween(sql, '2026-11-02', '2026-11-02', 'men')).toEqual([]);
      const counts = await getDayCounts(sql, '2026-11-02', '2026-11-02', 'men');
      expect(counts[0].in_squad).toBe(0);
    });
  });
});

describe('day queries (U.S. Eastern days)', () => {
  beforeEach(async () => {
    await upsertProviderMatches(sql, P, [
      // 11:30 p.m. EDT on Oct 31.
      match('late', '2026-11-01T03:30:00Z'),
      // 12:30 a.m. EDT on Nov 1 (clocks go back at 2 a.m. that night).
      match('early', '2026-11-01T04:30:00Z'),
      // 11:30 p.m. EST on Nov 1, after the change.
      match('after-dst', '2026-11-02T04:30:00Z'),
      match('postponed', '2026-11-01T18:00:00Z', { status: 'postponed' }),
      match('tbc', '2026-11-01T00:00:00Z', { kickoffConfirmed: false }),
      match('other', '2026-11-01T18:00:00Z', {
        home: { externalId: 'x', name: 'X', shortName: null },
        away: { externalId: 'y', name: 'Y', shortName: null },
      }),
    ]);
    await addPlayer('tracked-player', 'h1');
    await addPlayer('womens-player', 'a1', 'women');
  });

  it('groups by Eastern date across the DST change', async () => {
    const keysFor = async (day: string) => {
      const ms = await getMatchesBetween(sql, day, day, 'men');
      const r = await rows<{ source_key: string }>('select source_key from matches where id = any($1) order by kickoff_utc', [
        ms.map((m) => m.id),
      ]);
      return r.map((x) => x.source_key.split(':')[1]);
    };
    expect(await keysFor('2026-10-31')).toEqual(['tbc', 'late']);
    expect(await keysFor('2026-11-01')).toEqual(['early', 'postponed', 'after-dst']);
    expect(await keysFor('2026-11-02')).toEqual([]);
  });

  it('returns a range of days in day order, each match tagged with its Eastern day', async () => {
    const ms = await getMatchesBetween(sql, '2026-10-31', '2026-11-02', 'men');
    expect(ms.map((m) => m.day)).toEqual(['2026-10-31', '2026-10-31', '2026-11-01', '2026-11-01', '2026-11-01']);
    // Within a day, confirmed kickoffs still come first.
    expect(ms.filter((m) => m.day === '2026-10-31').map((m) => m.kickoff_confirmed)).toEqual([true, false]);
  });

  it('lists confirmed kickoffs first, then unconfirmed', async () => {
    const day = await getMatchesBetween(sql, '2026-10-31', '2026-10-31', 'men');
    expect(day.map((m) => m.kickoff_confirmed)).toEqual([true, false]);
  });

  it('counts players per day, skipping postponed matches and other pools', async () => {
    const counts = await getDayCounts(sql, '2026-10-31', '2026-11-02', 'men');
    expect(counts.map((c) => [c.day, c.in_squad])).toEqual([
      ['2026-10-31', 1],
      ['2026-11-01', 1],
      ['2026-11-02', 0],
    ]);
    const women = await getMatchesBetween(sql, '2026-11-01', '2026-11-01', 'women');
    expect(women[0].players.map((p) => p.slug)).toEqual(['womens-player']);
  });

  it('says which side each player is on', async () => {
    await addPlayer('away-player', 'a1');
    const [m] = (await getMatchesBetween(sql, '2026-11-01', '2026-11-01', 'men')).filter((x) => x.kickoff_confirmed);
    expect(m.players.map((p) => [p.slug, p.side])).toEqual([
      ['away-player', 'away'],
      ['tracked-player', 'home'],
    ]);
  });

  it('uses TV rights valid on the match’s Eastern date, unless the match has an override', async () => {
    const [{ id: pl }] = await rows<{ id: number }>(`select id from competitions where name = 'Premier League'`);
    // "late" kicks off on Nov 1 UTC but Oct 31 Eastern.
    await db.query(
      `insert into tv_rights (competition_id, network, valid_from, valid_to) values
         ($1, 'Old Network', '2026-08-01', '2026-10-31'),
         ($1, 'New Network', '2026-11-01', null)`,
      [pl],
    );
    const [late] = await getMatchesBetween(sql, '2026-10-31', '2026-10-31', 'men').then((ms) => ms.filter((m) => m.kickoff_confirmed));
    expect(late.watch).toEqual([{ network: 'Old Network', url: null }]);

    await db.query(`insert into broadcasts (match_id, network, url) values ($1, 'Special', 'https://example.com')`, [
      late.id,
    ]);
    const [again] = await getMatchesBetween(sql, '2026-10-31', '2026-10-31', 'men').then((ms) => ms.filter((m) => m.kickoff_confirmed));
    expect(again.watch).toEqual([{ network: 'Special', url: 'https://example.com' }]);
  });

  it('returns upcoming team matches with the same watch options', async () => {
    const [{ team_id }] = await rows<{ team_id: number }>(`select team_id from team_provider_ids where external_id = 'h1'`);
    // Which fixtures count as upcoming depends on the real clock, so only the shape is checked.
    const upcoming = await getUpcomingTeamMatches(sql, team_id, 10);
    for (const m of upcoming) expect(Array.isArray(m.watch)).toBe(true);
  });
});

describe('insertCorrection', () => {
  it('stops accepting once the hourly cap is reached', async () => {
    expect(await insertCorrection(sql, { pageUrl: '/', message: 'one' }, 2)).toBe(true);
    expect(await insertCorrection(sql, { pageUrl: null, message: 'two' }, 2)).toBe(true);
    expect(await insertCorrection(sql, { pageUrl: '/', message: 'three' }, 2)).toBe(false);
    expect(await rows('select count(*)::int as n from corrections')).toEqual([{ n: 2 }]);
  });
});

describe('competition order (migration 0005)', () => {
  it('ranks every seeded competition, Champions League above the Premier League', async () => {
    const ranked = await rows<{ name: string; display_order: number | null }>(
      'select name, display_order from competitions order by display_order',
    );
    expect(ranked.filter((c) => c.display_order === null)).toEqual([]);
    const names = ranked.map((c) => c.name);
    expect(names.indexOf('UEFA Champions League')).toBeLessThan(names.indexOf('Premier League'));
    expect(names.indexOf('Premier League')).toBeLessThan(names.indexOf('Championship'));
  });

  it('is returned with each day match', async () => {
    await upsertProviderMatches(sql, P, [match('1', '2026-10-31T19:00:00Z')]);
    await addPlayer('some-player', 'h1');
    const [m] = await getMatchesBetween(sql, '2026-10-31', '2026-10-31', 'men');
    expect(m.competition_order).toBe(10);
  });
});

describe('team crests (migration 0006)', () => {
  const crest = 'https://crests.football-data.org/1.png';
  const withCrest = (home: Partial<ProviderMatch['home']>) =>
    match('1', '2026-10-31T19:00:00Z', { home: { externalId: 'h1', name: 'Home FC', shortName: 'Home', ...home } });

  it('stores a crest, keeps it when a later sync has none, and returns it with day matches', async () => {
    await upsertProviderMatches(sql, P, [withCrest({ crestUrl: crest })]);
    await upsertProviderMatches(sql, P, [withCrest({ crestUrl: null })]);
    await addPlayer('some-player', 'h1');
    const [m] = await getMatchesBetween(sql, '2026-10-31', '2026-10-31', 'men');
    expect([m.home_crest, m.away_crest]).toEqual([crest, null]);
  });

  it('replaces a crest when the provider sends a new one', async () => {
    await upsertProviderMatches(sql, P, [withCrest({ crestUrl: crest })]);
    await upsertProviderMatches(sql, P, [withCrest({ crestUrl: 'https://crests.football-data.org/1.svg' })]);
    expect(await rows(`select crest_url from teams where name = 'Home FC'`)).toEqual([
      { crest_url: 'https://crests.football-data.org/1.svg' },
    ]);
  });

  it('drops non-https crest URLs instead of failing the sync', async () => {
    await upsertProviderMatches(sql, P, [withCrest({ crestUrl: 'javascript:alert(1)' })]);
    expect(await rows(`select crest_url from teams where name = 'Home FC'`)).toEqual([{ crest_url: null }]);
    await expect(db.query(`update teams set crest_url = 'http://example.com/x.png'`)).rejects.toThrow();
  });
});

describe('constraints from migration 0003', () => {
  it('rejects non-http links and backwards date ranges', async () => {
    const [{ id: pl }] = await rows<{ id: number }>(`select id from competitions limit 1`);
    await expect(
      db.query(`insert into tv_rights (competition_id, network, url, valid_from) values ($1, 'N', 'javascript:alert(1)', '2026-01-01')`, [pl]),
    ).rejects.toThrow(/tv_rights_url_http/);
    await expect(
      db.query(`insert into tv_rights (competition_id, network, valid_from, valid_to) values ($1, 'N', '2026-02-01', '2026-01-01')`, [pl]),
    ).rejects.toThrow(/tv_rights_dates_ordered/);
    await expect(
      db.query(`insert into players (slug, name, pool, eligibility_url) values ('a', 'A', 'men', 'data:text/html,hi')`),
    ).rejects.toThrow(/players_eligibility_url_http/);
    await db.query(`insert into players (slug, name, pool, eligibility_url) values ('b', 'B', 'men', 'HTTPS://example.com')`);
  });
});

describe('admin dashboard and metrics', () => {
  it('run against the schema', async () => {
    await upsertProviderMatches(sql, P, [match('1', '2026-10-31T19:00:00Z')]);
    await snapshotMetrics(sql, '2026-10-31');
    const dashboard = await getDashboard(sql);
    expect(dashboard.counts.missing_matches).toBe(0);
    expect(dashboard.metrics.map((m) => m.metric)).toContain('provider_calls');
  });
});
