// Calendar feed of a player's upcoming club matches: /calendar/<slug>.ics
import type { APIRoute } from 'astro';
import { getPlayerBySlug, getUpcomingTeamMatches } from '@usnt/db';
import { getDb } from '../../lib/db';
import { buildCalendar } from '../../lib/ics';

const MATCH_MINUTES = 120;

export const GET: APIRoute = async ({ params, url }) => {
  const sql = getDb();
  const player = params.slug ? await getPlayerBySlug(sql, params.slug) : null;
  if (!player) return new Response('Player not found', { status: 404 });

  const matches = player.current_team_id ? await getUpcomingTeamMatches(sql, player.current_team_id, 30) : [];
  const body = buildCalendar(
    `${player.name} matches`,
    matches.map((m) => {
      const watch = m.watch.length ? m.watch.map((w) => w.network).join(', ') : 'Not listed';
      const time = m.kickoff_confirmed ? '' : ' Kickoff time to be confirmed.';
      return {
        uid: `match-${m.id}-${player.slug}@usnt.today`,
        start: new Date(m.kickoff_utc),
        timed: m.kickoff_confirmed,
        durationMinutes: MATCH_MINUTES,
        summary: `${m.home} vs ${m.away}`,
        description: `${m.competition ?? 'Match'}. Watch: ${watch}.${time}`,
        url: `${url.origin}/player/${player.slug}`,
      };
    }),
  );

  return new Response(body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
