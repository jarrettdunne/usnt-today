// Queries for the admin site (apps/admin): editor tools, site analytics, monitoring.
import type { Sql } from './client';
import type {
  CallupInput,
  CallupRow,
  CorrectionRow,
  CorrectionStatus,
  Dashboard,
  Option,
  PlayerInput,
  PlayerListRow,
  TransferInput,
  TvRightInput,
  TvRightRow,
} from './types';

// ---- Options for form selects ------------------------------------------------

export async function listTeamOptions(sql: Sql): Promise<Option[]> {
  return (await sql`select id, name from teams order by name`) as unknown as Option[];
}

export async function listCompetitionOptions(sql: Sql): Promise<Option[]> {
  return (await sql`select id, name from competitions order by name`) as unknown as Option[];
}

export async function listPlayerOptions(sql: Sql): Promise<Option[]> {
  return (await sql`select id, name from players order by name`) as unknown as Option[];
}

// ---- Players -----------------------------------------------------------------

export async function listPlayers(sql: Sql): Promise<PlayerListRow[]> {
  const rows = await sql`
    select p.id, p.added_by, p.slug, p.name, p.pool, p.player_group, p.position,
           t.name as team, p.eligibility_source, p.eligibility_url
    from players p
    left join teams t on t.id = p.current_team_id
    order by p.pool, p.name`;
  return rows as unknown as PlayerListRow[];
}

export async function getPlayerForEdit(sql: Sql, id: number): Promise<(PlayerInput & { id: number }) | null> {
  const rows = await sql`
    select id, slug, name, pool, player_group, position, birth_date::text as birth_date,
           current_team_id, eligibility_source, eligibility_url, bio
    from players
    where id = ${id}`;
  return (rows[0] as (PlayerInput & { id: number }) | undefined) ?? null;
}

export async function createPlayer(sql: Sql, p: PlayerInput): Promise<number> {
  const rows = await sql`
    insert into players (slug, name, pool, player_group, position, birth_date,
                         current_team_id, eligibility_source, eligibility_url, bio)
    values (${p.slug}, ${p.name}, ${p.pool}, ${p.player_group}, ${p.position}, ${p.birth_date},
            ${p.current_team_id}, ${p.eligibility_source}, ${p.eligibility_url}, ${p.bio})
    returning id`;
  return (rows[0] as { id: number }).id;
}

export async function updatePlayer(sql: Sql, id: number, p: PlayerInput): Promise<void> {
  await sql`
    update players set
      slug = ${p.slug}, name = ${p.name}, pool = ${p.pool}, player_group = ${p.player_group},
      position = ${p.position}, birth_date = ${p.birth_date}, current_team_id = ${p.current_team_id},
      eligibility_source = ${p.eligibility_source}, eligibility_url = ${p.eligibility_url},
      bio = ${p.bio}, updated_at = now()
    where id = ${id}`;
}

// ---- Transfers and call-ups ----------------------------------------------------

/** Records a confirmed transfer and, unless it's an extension, moves the player's current club. */
export async function createTransfer(sql: Sql, t: TransferInput, updateCurrentTeam: boolean): Promise<void> {
  const insert = sql`
    insert into transfers (player_id, from_team_id, to_team_id, transfer_date, kind, fee_text, source_url)
    values (${t.player_id}, ${t.from_team_id}, ${t.to_team_id}, ${t.transfer_date}, ${t.kind},
            ${t.fee_text}, ${t.source_url})`;
  if (updateCurrentTeam && t.to_team_id !== null && t.kind !== 'extension') {
    await sql.transaction([
      insert,
      sql`update players set current_team_id = ${t.to_team_id}, updated_at = now() where id = ${t.player_id}`,
    ]);
  } else {
    await insert;
  }
}

export async function createCallup(sql: Sql, c: CallupInput): Promise<void> {
  await sql`
    insert into callups (player_id, level, window_start, window_end, source_url)
    values (${c.player_id}, ${c.level}, ${c.window_start}, ${c.window_end}, ${c.source_url})`;
}

export async function listRecentCallups(sql: Sql, limit = 50): Promise<CallupRow[]> {
  const rows = await sql`
    select c.id, c.level, c.window_start::text as window_start, c.window_end::text as window_end,
           c.source_url, p.slug as player_slug, p.name as player_name
    from callups c
    join players p on p.id = c.player_id
    order by c.window_start desc, c.id desc
    limit ${limit}`;
  return rows as unknown as CallupRow[];
}

// ---- U.S. TV rights ----------------------------------------------------------------

export async function listTvRights(sql: Sql): Promise<TvRightRow[]> {
  const rows = await sql`
    select r.id, r.competition_id, c.name as competition, r.network, r.url,
           r.valid_from::text as valid_from, r.valid_to::text as valid_to, r.notes
    from tv_rights r
    join competitions c on c.id = r.competition_id
    order by c.name, r.valid_from desc, r.network`;
  return rows as unknown as TvRightRow[];
}

export async function createTvRight(sql: Sql, r: TvRightInput): Promise<void> {
  await sql`
    insert into tv_rights (competition_id, network, url, valid_from, valid_to, notes)
    values (${r.competition_id}, ${r.network}, ${r.url}, ${r.valid_from}, ${r.valid_to}, ${r.notes})`;
}

export async function deleteTvRight(sql: Sql, id: number): Promise<void> {
  await sql`delete from tv_rights where id = ${id}`;
}

// ---- Corrections ---------------------------------------------------------------------

export async function listCorrections(sql: Sql): Promise<CorrectionRow[]> {
  const rows = await sql`
    select id, page_url, message, status, created_at
    from corrections
    order by (status = 'open') desc, created_at desc
    limit 200`;
  return rows as unknown as CorrectionRow[];
}

export async function setCorrectionStatus(sql: Sql, id: number, status: CorrectionStatus): Promise<void> {
  await sql`update corrections set status = ${status} where id = ${id}`;
}

// ---- Site analytics and monitoring ---------------------------------------------------

export async function getDashboard(sql: Sql): Promise<Dashboard> {
  const [counts, jobRuns, metrics] = await Promise.all([
    sql`
      select
        (select count(*)::int from players where pool = 'men') as players_men,
        (select count(*)::int from players where pool = 'women') as players_women,
        (select count(*)::int from players where player_group = 'active') as players_active,
        (select count(*)::int from players where player_group = 'eligible') as players_eligible,
        (select count(*)::int from players where current_team_id is null) as players_without_team,
        (select count(*)::int from matches m
          where m.kickoff_utc between now() and now() + interval '7 days'
            and m.missing_since is null
            and m.status not in ('postponed', 'cancelled')
            and exists (select 1 from players p
                         where p.current_team_id in (m.home_team_id, m.away_team_id))) as tracked_matches_next_7_days,
        (select count(*)::int from corrections where status = 'open') as open_corrections,
        (select count(*)::int from matches where missing_since is not null
            and kickoff_utc > now() - interval '30 days') as missing_matches,
        (select max(updated_at) from matches) as matches_updated_at`,
    sql`
      select id, job, started_at, finished_at, ok, calls, detail
      from job_runs
      order by started_at desc
      limit 20`,
    sql`
      select day::text as day, metric, value::float8 as value
      from metrics_daily
      where day >= current_date - 14
      order by day desc, metric`,
  ]);
  return {
    counts: counts[0] as unknown as Dashboard['counts'],
    jobRuns: jobRuns as unknown as Dashboard['jobRuns'],
    metrics: metrics as unknown as Dashboard['metrics'],
  };
}
