import type { AppearanceRole, MatchPlayer } from '@usnt/db';

const ROLES: AppearanceRole[] = ['starting', 'bench', 'squad', 'out'];

export const ROLE_LABELS: Record<AppearanceRole, string> = {
  starting: 'Starting',
  bench: 'Bench',
  squad: 'In squad',
  out: 'Out (injured or suspended)',
};

export interface TeamRow {
  team: string;
  roles: { role: AppearanceRole; players: MatchPlayer[] }[];
}

/**
 * One row per team that has tracked players, home first, with the players split
 * by role in lineup order (starting, bench, squad, out). Player order within a
 * role is kept from the query (by name).
 */
export function playersByTeam(match: { home: string; away: string; players: MatchPlayer[] }): TeamRow[] {
  const rows: TeamRow[] = [];
  for (const [side, team] of [
    ['home', match.home],
    ['away', match.away],
  ] as const) {
    const onTeam = match.players.filter((p) => p.side === side);
    if (onTeam.length === 0) continue;
    rows.push({
      team,
      roles: ROLES.map((role) => ({ role, players: onTeam.filter((p) => p.role === role) })).filter(
        (r) => r.players.length > 0,
      ),
    });
  }
  return rows;
}
