import type { MatchPlayer } from '@usnt/db';
import { describe, expect, it } from 'vitest';
import { playersByTeam } from './match-players';

function p(name: string, side: 'home' | 'away', role: MatchPlayer['role'] = 'squad'): MatchPlayer {
  return { slug: name.toLowerCase(), name, position: null, role, side };
}

describe('playersByTeam', () => {
  it('gives each team with players its own row, home first', () => {
    const rows = playersByTeam({ home: 'Home FC', away: 'Away FC', players: [p('Zed', 'away'), p('Amy', 'home')] });
    expect(rows.map((r) => [r.team, r.roles.map((x) => x.players.map((y) => y.name))])).toEqual([
      ['Home FC', [['Amy']]],
      ['Away FC', [['Zed']]],
    ]);
  });

  it('skips a team with no tracked players', () => {
    const rows = playersByTeam({ home: 'Home FC', away: 'Away FC', players: [p('Zed', 'away')] });
    expect(rows.map((r) => r.team)).toEqual(['Away FC']);
  });

  it('orders roles starting, bench, squad, out', () => {
    const [row] = playersByTeam({
      home: 'Home FC',
      away: 'Away FC',
      players: [p('A', 'home', 'out'), p('B', 'home', 'squad'), p('C', 'home', 'bench'), p('D', 'home', 'starting')],
    });
    expect(row.roles.map((r) => r.role)).toEqual(['starting', 'bench', 'squad', 'out']);
  });
});
