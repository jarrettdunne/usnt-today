// football-data.org v4, free tier: 12 competitions, 10 calls a minute, delayed scores, no lineups.
import type { MatchStatus, ProviderMatch, ProviderPlayer, ProviderTeam } from '@usnt/db';
import type { MatchProvider, SquadProvider } from '../types';

const BASE_URL = 'https://api.football-data.org/v4';
const FETCH_TIMEOUT_MS = 15_000;

export const FREE_COMPETITIONS = ['PL', 'ELC', 'BL1', 'SA', 'PD', 'FL1', 'DED', 'PPL', 'BSA', 'CL', 'EC', 'WC'];

/**
 * Club competitions whose squads are imported. EC and WC are left out: their teams
 * are national teams, which would replace players' clubs.
 */
export const SQUAD_COMPETITIONS = FREE_COMPETITIONS.filter((c) => c !== 'EC' && c !== 'WC');

/**
 * Free lite eligibility rule: a player football-data.org lists with U.S. nationality
 * is treated as eligible. It lists one nationality per player, so dual nationals
 * listed under another country are missed; editors add those by hand. The API
 * spells it both ways.
 */
export const US_NATIONALITIES = new Set(['USA', 'United States']);
const ELIGIBILITY_SOURCE = 'Nationality listed as USA by football-data.org';

const POSITIONS: Record<string, string> = {
  Goalkeeper: 'GK',
  Defence: 'DF',
  Midfield: 'MF',
  Offence: 'FW',
};

export interface FdTeam {
  id: number | null;
  name: string | null;
  shortName?: string | null;
  /** Crest image URL, e.g. https://crests.football-data.org/57.png (sometimes .svg). */
  crest?: string | null;
}

export interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  competition: { code: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: { fullTime: { home: number | null; away: number | null } };
}

// https://docs.football-data.org/general/v4/lookup_tables.html#_enums
export function mapStatus(status: string): MatchStatus {
  switch (status) {
    case 'IN_PLAY':
    case 'PAUSED':
    case 'EXTRA_TIME':
    case 'PENALTY_SHOOTOUT':
    case 'LIVE':
      return 'live';
    case 'FINISHED':
    case 'AWARDED':
      return 'finished';
    case 'POSTPONED':
    case 'SUSPENDED':
      return 'postponed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      // SCHEDULED, TIMED and anything new.
      return 'scheduled';
  }
}

/** SCHEDULED means the date is set but the kickoff time isn't; TIMED means it is. */
function isKickoffConfirmed(status: string): boolean {
  return status !== 'SCHEDULED';
}

/**
 * Knockout fixtures without decided teams are skipped until both teams are known.
 * A match with an unreadable date is skipped too, since one bad row would fail the
 * whole sync's transaction.
 */
export function isUsable(m: FdMatch): boolean {
  return (
    Boolean(m.homeTeam?.id && m.homeTeam.name && m.awayTeam?.id && m.awayTeam.name && m.competition?.code) &&
    !Number.isNaN(Date.parse(m.utcDate))
  );
}

export function toProviderMatch(m: FdMatch): ProviderMatch {
  return {
    externalId: String(m.id),
    competitionCode: m.competition.code,
    kickoffUtc: m.utcDate,
    kickoffConfirmed: isKickoffConfirmed(m.status),
    status: mapStatus(m.status),
    home: toProviderTeam(m.homeTeam),
    away: toProviderTeam(m.awayTeam),
    homeScore: m.score?.fullTime?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? null,
  };
}

export interface FdSquadPlayer {
  id: number;
  name: string | null;
  position: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
}

export interface FdSquadTeam extends FdTeam {
  squad?: FdSquadPlayer[];
}

function toProviderTeam(t: FdTeam): ProviderTeam {
  return {
    externalId: String(t.id),
    name: t.name as string,
    shortName: t.shortName ?? null,
    crestUrl: t.crest ?? null,
  };
}

/** Teams from /competitions/{code}/teams, plus their players with U.S. nationality. */
export function toSquads(teams: FdSquadTeam[]): { teams: ProviderTeam[]; players: ProviderPlayer[] } {
  const usable = teams.filter((t) => t.id && t.name);
  const players: ProviderPlayer[] = [];
  for (const t of usable) {
    const team = toProviderTeam(t);
    for (const p of t.squad ?? []) {
      if (!p.id || !p.name?.trim() || !US_NATIONALITIES.has(p.nationality ?? '')) continue;
      players.push({
        externalId: String(p.id),
        name: p.name.trim(),
        pool: 'men', // Every free-tier competition is a men's competition.
        position: p.position ? (POSITIONS[p.position] ?? p.position) : null,
        birthDate: p.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth) ? p.dateOfBirth : null,
        eligibilitySource: ELIGIBILITY_SOURCE,
        team,
      });
    }
  }
  return { teams: usable.map(toProviderTeam), players };
}

export function footballData(token: string): MatchProvider & SquadProvider {
  if (!token) throw new Error('FOOTBALL_DATA_TOKEN is not set');

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: { 'X-Auth-Token': token },
      // A hung request would otherwise hold the cron invocation open.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`football-data.org returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  return {
    key: 'football_data',
    squadBatchCount: SQUAD_COMPETITIONS.length,

    async fetchMatches(from, to) {
      const body = await get<{ matches?: FdMatch[] }>('/matches', {
        competitions: FREE_COMPETITIONS.join(','),
        dateFrom: from,
        dateTo: to,
      });
      const matches = (body.matches ?? []).filter(isUsable).map(toProviderMatch);
      return { matches, calls: 1 };
    },

    async fetchSquads(index) {
      const code = SQUAD_COMPETITIONS[index];
      if (!code) throw new Error(`No squad batch ${index}; there are ${SQUAD_COMPETITIONS.length}.`);
      const body = await get<{ teams?: FdSquadTeam[] }>(`/competitions/${code}/teams`);
      return { ...toSquads(body.teams ?? []), calls: 1, label: code };
    },
  };
}
