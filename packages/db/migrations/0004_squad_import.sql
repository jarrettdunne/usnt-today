-- Players imported from provider squad lists (in Free lite: anyone football-data.org
-- lists with U.S. nationality). Editors can still add, edit and override anyone.

-- 'editor' for players added in the admin, otherwise the provider key that imported them.
alter table players add column added_by text not null default 'editor';

-- When this provider last listed the player in a squad, and the club the sync last
-- gave them. A player whose current club differs from synced_team_id was changed by
-- an editor, and the sync leaves that club alone.
alter table player_provider_ids add column last_seen_at timestamptz;
alter table player_provider_ids add column synced_team_id integer references teams(id) on delete set null;
create index player_provider_ids_player_idx on player_provider_ids (player_id);

-- When this provider last returned the team's squad. A player's club is only cleared
-- after their team's squad has been fetched again without them, so a provider outage
-- never clears anyone.
alter table team_provider_ids add column squad_seen_at timestamptz;
create index team_provider_ids_team_idx on team_provider_ids (team_id);
