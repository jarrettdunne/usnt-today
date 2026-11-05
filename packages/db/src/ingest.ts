// Queries for the ingest jobs (jobs/). Written as a few set-based statements so
// each sync stays well under the Workers free plan's 50-subrequest limit.
import type { Sql } from './client';
import { addDays } from './dates';
import { slugify } from './slugs';
import type { ProviderMatch, ProviderPlayer, ProviderSquads, ProviderTeam, SyncWindow } from './types';

export async function startJobRun(sql: Sql, job: string): Promise<number> {
  const rows = await sql`insert into job_runs (job) values (${job}) returning id`;
  return (rows[0] as { id: number }).id;
}

export async function finishJobRun(
  sql: Sql,
  id: number,
  ok: boolean,
  calls: number,
  detail: string | null,
): Promise<void> {
  await sql`
    update job_runs
       set finished_at = now(), ok = ${ok}, calls = ${calls}, detail = ${detail}
     where id = ${id}`;
}

type TeamJson = { ext_id: string; name: string; short_name: string | null; crest_url: string | null };

/** Only https crest URLs are stored (the column's check constraint enforces the same). */
function httpsOrNull(url: string | null | undefined): string | null {
  return url && /^https:\/\//i.test(url) ? url : null;
}

/** Provider teams as JSON for jsonb_to_recordset, one entry per external ID. */
function teamJson(teams: ProviderTeam[]): string {
  const byId = new Map<string, TeamJson>();
  for (const t of teams) {
    byId.set(t.externalId, {
      ext_id: t.externalId,
      name: t.name,
      short_name: t.shortName,
      crest_url: httpsOrNull(t.crestUrl),
    });
  }
  return JSON.stringify([...byId.values()]);
}

/**
 * Statements that create teams this provider hasn't seen, refresh the names of teams
 * it created, and map its team IDs to ours. A team first created by another provider
 * and mapped to this one keeps its name, so two providers never fight over it.
 */
function teamStatements(sql: Sql, provider: string, teams: ProviderTeam[]) {
  const json = teamJson(teams);
  return [
    sql`
      with input as (
        select ext_id, name, short_name, crest_url
        from jsonb_to_recordset(${json}::jsonb) as t(ext_id text, name text, short_name text, crest_url text)
      )
      insert into teams (source_key, name, short_name, crest_url)
      select ${provider}::text || ':' || i.ext_id, i.name, i.short_name, i.crest_url
      from input i
      where not exists (
        select 1
        from team_provider_ids x
        join teams other on other.id = x.team_id
        where x.provider = ${provider}
          and x.external_id = i.ext_id
          and other.source_key is distinct from ${provider}::text || ':' || i.ext_id)
      on conflict (source_key) do update
        -- A sync without a crest never clears one that's already stored.
        set name = excluded.name,
            short_name = excluded.short_name,
            crest_url = coalesce(excluded.crest_url, teams.crest_url)
        where (teams.name, teams.short_name, teams.crest_url)
          is distinct from (excluded.name, excluded.short_name, coalesce(excluded.crest_url, teams.crest_url))`,
    sql`
      insert into team_provider_ids (provider, external_id, team_id)
      select ${provider}::text, i.ext_id, t.id
      from jsonb_to_recordset(${json}::jsonb) as i(ext_id text)
      join teams t on t.source_key = ${provider}::text || ':' || i.ext_id
      on conflict (provider, external_id) do nothing`,
  ];
}

/**
 * Upserts teams, provider ID mappings and matches in one transaction (one HTTP request).
 *
 * With `window`, matches stored inside it that the provider no longer returned are
 * flagged `missing_since` (usually rescheduled to a date outside the window), so the
 * site stops listing them on the old date. The first and last day of the window are
 * left alone so a provider counting days in a different time zone can't flag
 * matches right at the edges.
 */
export async function upsertProviderMatches(
  sql: Sql,
  provider: string,
  matches: ProviderMatch[],
  window?: SyncWindow,
): Promise<void> {
  // An empty response is more likely a provider hiccup than a genuinely empty
  // window, so it never flags anything as missing.
  if (matches.length === 0) return;

  const teams = matches.flatMap((m) => [m.home, m.away]);
  const matchJson = JSON.stringify(
    matches.map((m) => ({
      ext_id: m.externalId,
      competition_ext: m.competitionCode,
      kickoff_utc: m.kickoffUtc,
      kickoff_confirmed: m.kickoffConfirmed,
      status: m.status,
      home_ext: m.home.externalId,
      away_ext: m.away.externalId,
      home_score: m.homeScore,
      away_score: m.awayScore,
    })),
  );

  const statements = [
    ...teamStatements(sql, provider, teams),
    // Upsert the matches themselves. Finding a match again clears missing_since.
    sql`
      with input as (
        select distinct on (ext_id) *
        from jsonb_to_recordset(${matchJson}::jsonb) as m(
          ext_id text, competition_ext text, kickoff_utc timestamptz, kickoff_confirmed boolean,
          status text, home_ext text, away_ext text, home_score int, away_score int)
        order by ext_id
      )
      insert into matches (source_key, competition_id, kickoff_utc, kickoff_confirmed, status,
                           home_team_id, away_team_id, home_score, away_score, missing_since, updated_at)
      select ${provider}::text || ':' || i.ext_id, cp.competition_id, i.kickoff_utc, i.kickoff_confirmed,
             i.status, ht.team_id, awt.team_id, i.home_score, i.away_score, null, now()
      from input i
      left join competition_provider_ids cp
        on cp.provider = ${provider} and cp.external_id = i.competition_ext
      join team_provider_ids ht on ht.provider = ${provider} and ht.external_id = i.home_ext
      join team_provider_ids awt on awt.provider = ${provider} and awt.external_id = i.away_ext
      on conflict (source_key) do update set
        competition_id = excluded.competition_id,
        kickoff_utc = excluded.kickoff_utc,
        kickoff_confirmed = excluded.kickoff_confirmed,
        status = excluded.status,
        home_team_id = excluded.home_team_id,
        away_team_id = excluded.away_team_id,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        missing_since = null,
        updated_at = now()`,
  ];

  // Flag matches the provider stopped returning, inside the window minus its edge days.
  const flagFrom = window && addDays(window.from, 1);
  const flagTo = window?.to; // exclusive: midnight UTC at the start of the window's last day
  if (flagFrom && flagTo && flagFrom < flagTo) {
    statements.push(sql`
      update matches m
         set missing_since = now(), updated_at = now()
       where starts_with(m.source_key, ${provider}::text || ':')
         and m.missing_since is null
         and m.status <> 'finished'
         and m.kickoff_utc >= (${flagFrom}::date)::timestamp at time zone 'UTC'
         and m.kickoff_utc < (${flagTo}::date)::timestamp at time zone 'UTC'
         and not exists (
           select 1
           from jsonb_to_recordset(${matchJson}::jsonb) as i(ext_id text)
           where m.source_key = ${provider}::text || ':' || i.ext_id)`);
  }

  await sql.transaction(statements);
}

/** Days a player can be missing from their team's refetched squad before their club is cleared. */
const SQUAD_GRACE_DAYS = 2;

/**
 * Gives each new player a slug that's unique within the batch: the plain name slug,
 * or name + provider ID when two players in the batch share a name (or the name has
 * no usable letters). Clashes with existing players are handled in SQL.
 */
function batchSlugs(players: ProviderPlayer[]): Map<string, string> {
  const base = new Map(players.map((p) => [p.externalId, slugify(p.name) || 'player']));
  const counts = new Map<string, number>();
  for (const slug of base.values()) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  return new Map(
    [...base].map(([id, slug]) => [
      id,
      counts.get(slug)! > 1 || slug === 'player' ? `${slug}-${slugify(id)}` : slug,
    ]),
  );
}

/**
 * Imports one batch of provider squad lists, in one transaction:
 *
 * 1. Teams are created or mapped as for matches, and marked as just fetched.
 * 2. Players the provider hasn't linked yet are matched to an existing player with
 *    the same name and birth date (e.g. one an editor added), or created as
 *    Eligible with the provider's eligibility note.
 * 3. Linked players get the squad's club, unless an editor has set a different club
 *    (their current club no longer matches the one the sync last gave them).
 *    Empty position and birth date are filled in; names and editor fields never change.
 * 4. A player missing from their synced team's squad for SQUAD_GRACE_DAYS of refetches
 *    loses that club (they moved somewhere the provider doesn't cover).
 */
export async function upsertProviderSquads(sql: Sql, provider: string, squads: ProviderSquads): Promise<void> {
  // An empty batch is more likely a provider hiccup; skipping it also means no
  // team is marked as fetched, so nobody's club is cleared because of it.
  if (squads.teams.length === 0) return;

  const slugs = batchSlugs(squads.players);
  const playerJson = JSON.stringify(
    squads.players.map((p) => ({
      ext_id: p.externalId,
      name: p.name,
      slug: slugs.get(p.externalId),
      pool: p.pool,
      position: p.position,
      birth_date: p.birthDate,
      eligibility_source: p.eligibilitySource,
      team_ext: p.team.externalId,
    })),
  );
  const fetchedTeamJson = teamJson(squads.teams);
  const input = sql`
    select distinct on (i.ext_id) i.*, tp.team_id
    from jsonb_to_recordset(${playerJson}::jsonb) as i(
      ext_id text, name text, slug text, pool text, position text, birth_date date,
      eligibility_source text, team_ext text)
    join team_provider_ids tp on tp.provider = ${provider} and tp.external_id = i.team_ext
    order by i.ext_id`;

  await sql.transaction([
    // 1. Teams, including the squads' own teams with no players of interest.
    ...teamStatements(sql, provider, [...squads.teams, ...squads.players.map((p) => p.team)]),
    sql`
      update team_provider_ids x
         set squad_seen_at = now()
        from jsonb_to_recordset(${fetchedTeamJson}::jsonb) as i(ext_id text)
       where x.provider = ${provider} and x.external_id = i.ext_id`,

    // 2a. Link unlinked players to an existing, unlinked player with the same name and
    //     birth date (or no birth date on record).
    sql`
      with input as (${input}),
      candidates as (
        select distinct on (i.ext_id) i.ext_id, p.id as player_id
        from input i
        join players p
          on lower(p.name) = lower(i.name)
         and p.pool = i.pool
         and (p.birth_date = i.birth_date or p.birth_date is null or i.birth_date is null)
        where not exists (
                select 1 from player_provider_ids x where x.provider = ${provider} and x.external_id = i.ext_id)
          and not exists (
                select 1 from player_provider_ids x where x.provider = ${provider} and x.player_id = p.id)
        order by i.ext_id, (p.birth_date = i.birth_date) desc nulls last, p.id
      )
      insert into player_provider_ids (provider, external_id, player_id)
      select distinct on (c.player_id) ${provider}::text, c.ext_id, c.player_id
      from candidates c
      order by c.player_id, c.ext_id
      on conflict (provider, external_id) do nothing`,

    // 2b. Create the rest as Eligible. A slug already taken gets the provider ID added.
    sql`
      with input as (${input}),
      new_players as (
        select i.*,
               case when exists (select 1 from players p where p.slug = i.slug)
                    then i.slug || '-' || regexp_replace(lower(i.ext_id), '[^a-z0-9]+', '-', 'g')
                    else i.slug end as final_slug
        from input i
        where not exists (
          select 1 from player_provider_ids x where x.provider = ${provider} and x.external_id = i.ext_id)
      ),
      inserted as (
        insert into players (slug, name, pool, player_group, position, birth_date, current_team_id,
                             eligibility_source, added_by)
        select n.final_slug, n.name, n.pool, 'eligible', n.position, n.birth_date, n.team_id,
               n.eligibility_source, ${provider}
        from new_players n
        on conflict (slug) do nothing
        returning id, slug
      )
      insert into player_provider_ids (provider, external_id, player_id, synced_team_id)
      select ${provider}::text, n.ext_id, ins.id, n.team_id
      from inserted ins
      join new_players n on n.final_slug = ins.slug`,

    // 3. Clubs and empty fields for every linked player in the batch.
    sql`
      with input as (${input}),
      changes as (
        select p.id,
               case when p.current_team_id is null or p.current_team_id = x.synced_team_id
                    then i.team_id else p.current_team_id end as team_id,
               i.position, i.birth_date
        from input i
        join player_provider_ids x on x.provider = ${provider} and x.external_id = i.ext_id
        join players p on p.id = x.player_id
      )
      update players p
         set current_team_id = c.team_id,
             position = coalesce(p.position, c.position),
             birth_date = coalesce(p.birth_date, c.birth_date),
             updated_at = now()
        from changes c
       where p.id = c.id
         and (p.current_team_id is distinct from c.team_id
              or (p.position is null and c.position is not null)
              or (p.birth_date is null and c.birth_date is not null))`,
    // Runs after 3: a player now at the squad's club is synced to it again, which also
    // re-attaches an editor override once the provider agrees with it.
    sql`
      with input as (${input})
      update player_provider_ids x
         set last_seen_at = now(),
             synced_team_id = case when p.current_team_id = i.team_id then i.team_id else x.synced_team_id end
        from input i, players p
       where x.provider = ${provider}
         and x.external_id = i.ext_id
         and p.id = x.player_id`,

    // 4. Clear the club of players their synced team's squad has stopped listing.
    sql`
      with gone as (
        select x.provider, x.external_id, x.player_id, x.synced_team_id
        from player_provider_ids x
        where x.provider = ${provider}
          and x.synced_team_id is not null
          and exists (
            select 1 from team_provider_ids tp
            where tp.provider = x.provider
              and tp.team_id = x.synced_team_id
              and tp.squad_seen_at > coalesce(x.last_seen_at, '-infinity'::timestamptz)
                                     + make_interval(days => ${SQUAD_GRACE_DAYS}))
      ),
      unsynced as (
        update player_provider_ids x
           set synced_team_id = null
          from gone g
         where x.provider = g.provider and x.external_id = g.external_id
      )
      update players p
         set current_team_id = null, updated_at = now()
        from gone g
       where p.id = g.player_id
         and p.current_team_id = g.synced_team_id`,
  ]);
}

/** Daily site-analytics snapshot shown on the admin dashboard. */
export async function snapshotMetrics(sql: Sql, day: string): Promise<void> {
  await sql`
    insert into metrics_daily (day, metric, value)
    select ${day}::date, s.metric, s.value
    from (
      select 'players_men' as metric, count(*)::numeric as value from players where pool = 'men'
      union all
      select 'players_women', count(*) from players where pool = 'women'
      union all
      select 'players_eligible', count(*) from players where player_group = 'eligible'
      union all
      select 'tracked_matches_next_7_days', count(*)
        from matches m
       where m.kickoff_utc between now() and now() + interval '7 days'
         and m.missing_since is null
         and m.status not in ('postponed', 'cancelled')
         and exists (select 1 from players p
                      where p.current_team_id in (m.home_team_id, m.away_team_id))
      union all
      select 'provider_calls', coalesce(sum(calls), 0)
        from job_runs
       where started_at >= ${day}::date and started_at < ${day}::date + 1
      union all
      select 'open_corrections', count(*) from corrections where status = 'open'
    ) s
    on conflict (day, metric) do update set value = excluded.value`;
}
