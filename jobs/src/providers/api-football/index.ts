// Placeholder for the Lite + live data tier (API-Football Pro, $19/mo).
// Implement fetchMatches with /fixtures?date=YYYY-MM-DD (or ?from=&to=&league=&season=),
// then add jobs for lineups (/fixtures/lineups) and post-match player stats
// (/fixtures/players), writing to the appearances table.
import type { MatchProvider } from '../types';

export function apiFootball(apiKey: string): MatchProvider {
  if (!apiKey) throw new Error('API_FOOTBALL_KEY is not set');
  return {
    key: 'api_football',
    async fetchMatches() {
      throw new Error('The API-Football adapter is not implemented yet.');
    },
  };
}
