import { describe, expect, it } from 'vitest';
import { SQUAD_COMPETITIONS, isUsable, mapStatus, toProviderMatch, toSquads, type FdMatch, type FdSquadTeam } from './index';

const base: FdMatch = {
  id: 42,
  utcDate: '2026-10-31T15:00:00Z',
  status: 'TIMED',
  competition: { code: 'PL' },
  homeTeam: { id: 1, name: 'Home FC', shortName: 'Home', crest: 'https://crests.football-data.org/1.png' },
  awayTeam: { id: 2, name: 'Away FC', shortName: null },
  score: { fullTime: { home: null, away: null } },
};

describe('mapStatus', () => {
  it.each([
    ['SCHEDULED', 'scheduled'],
    ['TIMED', 'scheduled'],
    ['IN_PLAY', 'live'],
    ['PAUSED', 'live'],
    ['EXTRA_TIME', 'live'],
    ['PENALTY_SHOOTOUT', 'live'],
    ['FINISHED', 'finished'],
    ['AWARDED', 'finished'],
    ['POSTPONED', 'postponed'],
    ['SUSPENDED', 'postponed'],
    ['CANCELLED', 'cancelled'],
    ['SOMETHING_NEW', 'scheduled'],
  ])('%s -> %s', (status, expected) => {
    expect(mapStatus(status)).toBe(expected);
  });
});

describe('toProviderMatch', () => {
  it('marks TIMED kickoffs as confirmed and SCHEDULED ones as not', () => {
    expect(toProviderMatch(base).kickoffConfirmed).toBe(true);
    expect(toProviderMatch({ ...base, status: 'SCHEDULED' }).kickoffConfirmed).toBe(false);
    // Once played, a match's time is no longer a placeholder.
    expect(toProviderMatch({ ...base, status: 'FINISHED' }).kickoffConfirmed).toBe(true);
  });

  it('maps IDs, names and scores', () => {
    const m = toProviderMatch({ ...base, status: 'FINISHED', score: { fullTime: { home: 2, away: 1 } } });
    expect(m).toMatchObject({
      externalId: '42',
      competitionCode: 'PL',
      home: { externalId: '1', name: 'Home FC', shortName: 'Home', crestUrl: 'https://crests.football-data.org/1.png' },
      away: { externalId: '2', name: 'Away FC', shortName: null, crestUrl: null },
      homeScore: 2,
      awayScore: 1,
    });
  });
});

describe('isUsable', () => {
  it('skips fixtures without both teams or with a bad date', () => {
    expect(isUsable(base)).toBe(true);
    expect(isUsable({ ...base, homeTeam: { id: null, name: null } })).toBe(false);
    expect(isUsable({ ...base, awayTeam: { id: 2, name: null } })).toBe(false);
    expect(isUsable({ ...base, utcDate: 'not a date' })).toBe(false);
  });
});

describe('toSquads', () => {
  const teams: FdSquadTeam[] = [
    {
      id: 10,
      name: 'Fulham FC',
      shortName: 'Fulham',
      squad: [
        { id: 1, name: ' Some Defender ', position: 'Defence', dateOfBirth: '1997-08-08', nationality: 'USA' },
        { id: 2, name: 'Other Keeper', position: 'Goalkeeper', dateOfBirth: null, nationality: 'United States' },
        { id: 3, name: 'Not American', position: 'Offence', dateOfBirth: '2000-01-01', nationality: 'England' },
        { id: 4, name: 'Odd Position', position: 'Left-Back', dateOfBirth: 'unknown', nationality: 'USA' },
        { id: 5, name: null, position: null, dateOfBirth: null, nationality: 'USA' },
      ],
    },
    { id: 11, name: 'No Americans FC', squad: [] },
    { id: null, name: null },
  ];

  it('keeps only players listed with U.S. nationality, as Eligible men', () => {
    const { players } = toSquads(teams);
    expect(players.map((p) => p.externalId)).toEqual(['1', '2', '4']);
    expect(players[0]).toEqual({
      externalId: '1',
      name: 'Some Defender',
      pool: 'men',
      position: 'DF',
      birthDate: '1997-08-08',
      eligibilitySource: 'Nationality listed as USA by football-data.org',
      team: { externalId: '10', name: 'Fulham FC', shortName: 'Fulham', crestUrl: null },
    });
    expect(players[1].position).toBe('GK');
    expect(players[2]).toMatchObject({ position: 'Left-Back', birthDate: null });
  });

  it('returns every usable team, including ones with no eligible players', () => {
    expect(toSquads(teams).teams.map((t) => t.externalId)).toEqual(['10', '11']);
  });
});

describe('SQUAD_COMPETITIONS', () => {
  it('leaves out national-team tournaments', () => {
    expect(SQUAD_COMPETITIONS).not.toContain('WC');
    expect(SQUAD_COMPETITIONS).not.toContain('EC');
    expect(SQUAD_COMPETITIONS).toHaveLength(10);
  });
});
