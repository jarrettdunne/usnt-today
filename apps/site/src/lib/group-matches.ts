/** Heading for matches whose competition isn't in our competitions table. */
export const OTHER_COMPETITION = 'Other competitions';

interface Groupable {
  competition: string | null;
  /** competitions.display_order: lower sorts first, null after every ranked one. */
  competition_order: number | null;
}

/**
 * Groups a day's matches by competition, top competitions first (display_order),
 * then unranked ones alphabetically, then unknown competitions. Matches keep their
 * order within each group (the query sorts them by kickoff, unconfirmed times last).
 */
export function groupByCompetition<T extends Groupable>(
  matches: T[],
): { competition: string; order: number | null; matches: T[] }[] {
  const groups = new Map<string, { competition: string; order: number | null; matches: T[] }>();
  for (const m of matches) {
    const key = m.competition ?? OTHER_COMPETITION;
    const group = groups.get(key);
    if (group) group.matches.push(m);
    else groups.set(key, { competition: key, order: m.competition ? m.competition_order : null, matches: [m] });
  }
  return [...groups.values()].sort((a, b) => {
    const aOther = a.competition === OTHER_COMPETITION;
    const bOther = b.competition === OTHER_COMPETITION;
    if (aOther !== bOther) return aOther ? 1 : -1;
    if (a.order !== b.order) {
      if (a.order === null) return 1;
      if (b.order === null) return -1;
      return a.order - b.order;
    }
    return a.competition.localeCompare(b.competition, 'en');
  });
}
