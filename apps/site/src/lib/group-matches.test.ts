import { describe, expect, it } from 'vitest';
import { OTHER_COMPETITION, groupByCompetition } from './group-matches';

describe('groupByCompetition', () => {
  it('puts top competitions first, then unranked ones alphabetically, then unknown ones', () => {
    const matches = [
      { id: 1, competition: 'Bundesliga', competition_order: 13 },
      { id: 2, competition: null, competition_order: null },
      { id: 3, competition: 'Premier League', competition_order: 10 },
      { id: 4, competition: 'Bundesliga', competition_order: 13 },
      { id: 5, competition: 'Zeta Cup', competition_order: null },
      { id: 6, competition: 'Alpha Cup', competition_order: null },
      { id: 7, competition: 'UEFA Champions League', competition_order: 3 },
    ];
    expect(groupByCompetition(matches).map((g) => [g.competition, g.matches.map((m) => m.id)])).toEqual([
      ['UEFA Champions League', [7]],
      ['Premier League', [3]],
      ['Bundesliga', [1, 4]],
      ['Alpha Cup', [6]],
      ['Zeta Cup', [5]],
      [OTHER_COMPETITION, [2]],
    ]);
  });

  it('returns nothing for no matches', () => {
    expect(groupByCompetition([])).toEqual([]);
  });
});
