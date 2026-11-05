// Queries for the public site (apps/site).
import type { Sql } from './client';
import { SITE_TZ } from './dates';
import type {
  CallupRow,
  DayCount,
  DayMatch,
  MatchSummary,
  PlayerProfile,
  Pool,
  TransferRow,
} from './types';

/**
 * Where to watch match `m` in the U.S.: per-match overrides first, otherwise the
 * competition's rights on the match's U.S. Eastern date. Embedded in queries
 * that alias matches as `m`.
 */
function watchOptions(sql: Sql) {
  return sql`
    coalesce(
      (select json_agg(json_build_object('network', b.network, 'url', b.url) order by b.network)
         from broadcasts b
        where b.match_id = m.id),
      (select json_agg(json_build_object('network', r.network, 'url', r.url) order by r.network)
         from tv_rights r
        where r.competition_id = m.competition_id
          and r.valid_from <= (m.kickoff_utc at time zone ${SITE_TZ})::date
          and (r.valid_to is null or r.valid_to >= (m.kickoff_utc at time zone ${SITE_TZ})::date)),
      '[]'::json)`;
}

/** Player counts for each day from `from` to `to` (inclusive) for the date strip. */
export async function getDayCounts(sql: Sql, from: string, to: string, pool: Pool): Promise<DayCount[]> {
  // Days are U.S. Eastern; comparing kickoff_utc to each day's start and end
  // (rather than converting every kickoff) lets Postgres use matches_kickoff_idx.
  const rows = await sql`
    with days as (
      select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day
    )
    select d.day::text as day,
           count(distinct p.id)::int as in_squad,
           (count(distinct a.player_id) filter (where a.role = 'starting'))::int as starting,
           (count(distinct a.player_id) filter (where a.role = 'bench'))::int as bench,
           (count(distinct a.player_id) filter (where a.role = 'out'))::int as out_count
    from days d
    left join matches m
      on m.kickoff_utc >= d.day::timestamp at time zone ${SITE_TZ}
     and m.kickoff_utc < (d.day + 1)::timestamp at time zone ${SITE_TZ}
     and m.missing_since is null
     and m.status not in ('postponed', 'cancelled')
    left join players p
      on p.pool = ${pool}
     and p.current_team_id in (m.home_team_id, m.away_team_id)
    left join appearances a
      on a.match_id = m.id
     and a.player_id = p.id
    group by d.day
    order by d.day`;
  return rows as unknown as DayCount[];
}

/**
 * Matches from the start of U.S. Eastern day `from` to the end of day `to`
 * (inclusive) that involve at least one tracked player from the pool. Sorted by
 * day, then confirmed kickoffs first in kickoff order.
 */
export async function getMatchesBetween(sql: Sql, from: string, to: string, pool: Pool): Promise<DayMatch[]> {
  const rows = await sql`
    select m.id, (m.kickoff_utc at time zone ${SITE_TZ})::date::text as day,
           m.kickoff_utc, m.kickoff_confirmed, m.status, m.home_score, m.away_score,
           c.name as competition, c.display_order as competition_order, ht.name as home, awt.name as away,
           ht.crest_url as home_crest, awt.crest_url as away_crest,
           coalesce((
             select json_agg(json_build_object(
                      'slug', p.slug,
                      'name', p.name,
                      'position', p.position,
                      'role', coalesce(a.role, 'squad'),
                      'side', case when p.current_team_id = m.home_team_id then 'home' else 'away' end)
                    order by p.name)
             from players p
             left join appearances a on a.match_id = m.id and a.player_id = p.id
             where p.pool = ${pool}
               and p.current_team_id in (m.home_team_id, m.away_team_id)
           ), '[]'::json) as players,
           ${watchOptions(sql)} as watch
    from matches m
    join teams ht on ht.id = m.home_team_id
    join teams awt on awt.id = m.away_team_id
    left join competitions c on c.id = m.competition_id
    where m.kickoff_utc >= (${from}::date)::timestamp at time zone ${SITE_TZ}
      and m.kickoff_utc < (${to}::date + 1)::timestamp at time zone ${SITE_TZ}
      and m.missing_since is null
      and exists (
        select 1 from players p
        where p.pool = ${pool}
          and p.current_team_id in (m.home_team_id, m.away_team_id))
    order by day, m.kickoff_confirmed desc, m.kickoff_utc, m.id`;
  return rows as unknown as DayMatch[];
}

export async function getPlayerBySlug(sql: Sql, slug: string): Promise<PlayerProfile | null> {
  const rows = await sql`
    select p.id, p.slug, p.name, p.pool, p.player_group, p.position,
           p.birth_date::text as birth_date, p.eligibility_source, p.eligibility_url,
           p.bio, p.current_team_id, t.name as team
    from players p
    left join teams t on t.id = p.current_team_id
    where p.slug = ${slug}`;
  return (rows[0] as PlayerProfile | undefined) ?? null;
}

export async function getUpcomingTeamMatches(sql: Sql, teamId: number, limit = 5): Promise<MatchSummary[]> {
  const rows = await sql`
    select m.id, m.kickoff_utc, m.kickoff_confirmed, m.status, m.home_score, m.away_score,
           c.name as competition, ht.name as home, awt.name as away,
           ${watchOptions(sql)} as watch
    from matches m
    join teams ht on ht.id = m.home_team_id
    join teams awt on awt.id = m.away_team_id
    left join competitions c on c.id = m.competition_id
    where ${teamId} in (m.home_team_id, m.away_team_id)
      and m.kickoff_utc >= now()
      and m.missing_since is null
      and m.status not in ('finished', 'cancelled')
    order by m.kickoff_utc
    limit ${limit}`;
  return rows as unknown as MatchSummary[];
}

export async function getRecentTeamMatches(sql: Sql, teamId: number, limit = 5): Promise<MatchSummary[]> {
  const rows = await sql`
    select m.id, m.kickoff_utc, m.kickoff_confirmed, m.status, m.home_score, m.away_score,
           c.name as competition, ht.name as home, awt.name as away,
           '[]'::json as watch
    from matches m
    join teams ht on ht.id = m.home_team_id
    join teams awt on awt.id = m.away_team_id
    left join competitions c on c.id = m.competition_id
    where ${teamId} in (m.home_team_id, m.away_team_id)
      and m.kickoff_utc < now()
      and m.missing_since is null
    order by m.kickoff_utc desc
    limit ${limit}`;
  return rows as unknown as MatchSummary[];
}

export async function getRecentTransfers(sql: Sql, limit = 100): Promise<TransferRow[]> {
  const rows = await sql`
    select tr.id, tr.transfer_date::text as transfer_date, tr.kind, tr.fee_text, tr.source_url,
           p.slug as player_slug, p.name as player_name,
           ft.name as from_team, tt.name as to_team
    from transfers tr
    join players p on p.id = tr.player_id
    left join teams ft on ft.id = tr.from_team_id
    left join teams tt on tt.id = tr.to_team_id
    order by tr.transfer_date desc, tr.id desc
    limit ${limit}`;
  return rows as unknown as TransferRow[];
}

export async function getPlayerTransfers(sql: Sql, playerId: number): Promise<TransferRow[]> {
  const rows = await sql`
    select tr.id, tr.transfer_date::text as transfer_date, tr.kind, tr.fee_text, tr.source_url,
           p.slug as player_slug, p.name as player_name,
           ft.name as from_team, tt.name as to_team
    from transfers tr
    join players p on p.id = tr.player_id
    left join teams ft on ft.id = tr.from_team_id
    left join teams tt on tt.id = tr.to_team_id
    where tr.player_id = ${playerId}
    order by tr.transfer_date desc, tr.id desc`;
  return rows as unknown as TransferRow[];
}

export async function getPlayerCallups(sql: Sql, playerId: number): Promise<CallupRow[]> {
  const rows = await sql`
    select c.id, c.level, c.window_start::text as window_start, c.window_end::text as window_end,
           c.source_url, p.slug as player_slug, p.name as player_name
    from callups c
    join players p on p.id = c.player_id
    where c.player_id = ${playerId}
    order by c.window_start desc`;
  return rows as unknown as CallupRow[];
}

/**
 * Saves a reader's correction unless `hourlyCap` corrections already arrived in
 * the last hour (a backstop against floods filling the free database).
 * Returns false when the cap was hit.
 */
export async function insertCorrection(
  sql: Sql,
  input: { pageUrl: string | null; message: string },
  hourlyCap: number,
): Promise<boolean> {
  const rows = await sql`
    insert into corrections (page_url, message)
    select ${input.pageUrl}, ${input.message}
    where (select count(*) from corrections where created_at > now() - interval '1 hour') < ${hourlyCap}
    returning id`;
  return rows.length > 0;
}
