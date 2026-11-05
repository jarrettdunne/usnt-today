-- usnt.today schema, Free lite tier.
-- Provider IDs live in *_provider_ids tables so a second data provider can be
-- added without changing these tables.

create table competitions (
  id serial primary key,
  name text not null,
  country text,
  is_womens boolean not null default false
);

create table competition_provider_ids (
  provider text not null,
  external_id text not null,
  competition_id integer not null references competitions(id) on delete cascade,
  primary key (provider, external_id)
);

create table teams (
  id serial primary key,
  name text not null,
  short_name text,
  is_national_team boolean not null default false,
  -- provider:external_id of the provider that first created this team
  source_key text unique,
  created_at timestamptz not null default now()
);

create table team_provider_ids (
  provider text not null,
  external_id text not null,
  team_id integer not null references teams(id) on delete cascade,
  primary key (provider, external_id)
);

create table players (
  id serial primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  pool text not null check (pool in ('men', 'women')),
  player_group text not null default 'active' check (player_group in ('active', 'eligible')),
  position text,
  birth_date date,
  current_team_id integer references teams(id) on delete set null,
  eligibility_source text,
  eligibility_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index players_team_idx on players (current_team_id);

create table player_provider_ids (
  provider text not null,
  external_id text not null,
  player_id integer not null references players(id) on delete cascade,
  primary key (provider, external_id)
);

create table matches (
  id serial primary key,
  -- provider:external_id
  source_key text not null unique,
  competition_id integer references competitions(id) on delete set null,
  kickoff_utc timestamptz not null,
  status text not null check (status in ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  home_team_id integer not null references teams(id),
  away_team_id integer not null references teams(id),
  home_score integer,
  away_score integer,
  updated_at timestamptz not null default now()
);
create index matches_kickoff_idx on matches (kickoff_utc);
create index matches_home_idx on matches (home_team_id, kickoff_utc);
create index matches_away_idx on matches (away_team_id, kickoff_utc);

-- Empty in Free lite; filled by lineup data from the Lite + live data tier up.
create table appearances (
  match_id integer not null references matches(id) on delete cascade,
  player_id integer not null references players(id) on delete cascade,
  role text not null check (role in ('starting', 'bench', 'squad', 'out')),
  minutes integer,
  goals integer,
  assists integer,
  yellow_cards integer,
  red_cards integer,
  primary key (match_id, player_id)
);

-- Editor-kept U.S. TV and streaming rights per competition.
create table tv_rights (
  id serial primary key,
  competition_id integer not null references competitions(id) on delete cascade,
  network text not null,
  url text,
  valid_from date not null,
  valid_to date,
  notes text
);

-- Per-match where-to-watch overrides.
create table broadcasts (
  match_id integer not null references matches(id) on delete cascade,
  network text not null,
  url text,
  primary key (match_id, network)
);

-- Facts only: every transfer needs an official source link.
create table transfers (
  id serial primary key,
  player_id integer not null references players(id) on delete cascade,
  from_team_id integer references teams(id) on delete set null,
  to_team_id integer references teams(id) on delete set null,
  transfer_date date not null,
  kind text not null check (kind in ('permanent', 'loan', 'loan_return', 'free', 'extension')),
  fee_text text,
  source_url text not null,
  created_at timestamptz not null default now()
);
create index transfers_player_idx on transfers (player_id, transfer_date desc);

create table callups (
  id serial primary key,
  player_id integer not null references players(id) on delete cascade,
  level text not null check (level in ('senior', 'u23', 'u20', 'u17')),
  window_start date not null,
  window_end date,
  source_url text not null
);
create index callups_player_idx on callups (player_id, window_start desc);

create table corrections (
  id serial primary key,
  page_url text,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  created_at timestamptz not null default now()
);

-- Site analytics and monitoring (admin site only).
create table job_runs (
  id serial primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  calls integer not null default 0,
  detail text
);
create index job_runs_started_idx on job_runs (started_at desc);

create table metrics_daily (
  day date not null,
  metric text not null,
  value numeric not null,
  primary key (day, metric)
);
