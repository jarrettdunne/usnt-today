export type Pool = 'men' | 'women';
export type PlayerGroup = 'active' | 'eligible';
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
export type AppearanceRole = 'starting' | 'bench' | 'squad' | 'out';
export type TransferKind = 'permanent' | 'loan' | 'loan_return' | 'free' | 'extension';
export type CallupLevel = 'senior' | 'u23' | 'u20' | 'u17';
export type CorrectionStatus = 'open' | 'resolved' | 'rejected';

// Timestamps come back from the driver as Date objects; dates are cast to text in SQL.
export type Timestamp = Date | string;

// ---- Public site ------------------------------------------------------------

export interface DayCount {
  day: string;
  in_squad: number;
  starting: number;
  bench: number;
  out_count: number;
}

export interface MatchPlayer {
  slug: string;
  name: string;
  position: string | null;
  role: AppearanceRole;
  /** Which team in the match the player is on (by their current club). */
  side: 'home' | 'away';
}

export interface WatchOption {
  network: string;
  url: string | null;
}

export interface MatchSummary {
  id: number;
  kickoff_utc: Timestamp;
  /** False while the provider only knows the date, not the kickoff time. */
  kickoff_confirmed: boolean;
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  competition: string | null;
  home: string;
  away: string;
  watch: WatchOption[];
}

export interface DayMatch extends MatchSummary {
  /** The U.S. Eastern day the match is on (YYYY-MM-DD). */
  day: string;
  /** Crest image URLs (https), or null when the provider hasn't sent one. */
  home_crest: string | null;
  away_crest: string | null;
  /** Where the competition sorts on day pages (lower first); null sorts last. */
  competition_order: number | null;
  players: MatchPlayer[];
}

export interface PlayerProfile {
  id: number;
  slug: string;
  name: string;
  pool: Pool;
  player_group: PlayerGroup;
  position: string | null;
  birth_date: string | null;
  eligibility_source: string | null;
  eligibility_url: string | null;
  bio: string | null;
  current_team_id: number | null;
  team: string | null;
}

export interface TransferRow {
  id: number;
  transfer_date: string;
  kind: TransferKind;
  fee_text: string | null;
  source_url: string;
  player_slug: string;
  player_name: string;
  from_team: string | null;
  to_team: string | null;
}

export interface CallupRow {
  id: number;
  level: CallupLevel;
  window_start: string;
  window_end: string | null;
  source_url: string;
  player_slug: string;
  player_name: string;
}

// ---- Admin --------------------------------------------------------------------

export interface PlayerInput {
  slug: string;
  name: string;
  pool: Pool;
  player_group: PlayerGroup;
  position: string | null;
  birth_date: string | null;
  current_team_id: number | null;
  eligibility_source: string | null;
  eligibility_url: string | null;
  bio: string | null;
}

export interface PlayerListRow {
  id: number;
  /** 'editor', or the provider key that imported the player. */
  added_by: string;
  slug: string;
  name: string;
  pool: Pool;
  player_group: PlayerGroup;
  position: string | null;
  team: string | null;
  eligibility_source: string | null;
  eligibility_url: string | null;
}

export interface Option {
  id: number;
  name: string;
}

export interface TransferInput {
  player_id: number;
  from_team_id: number | null;
  to_team_id: number | null;
  transfer_date: string;
  kind: TransferKind;
  fee_text: string | null;
  source_url: string;
}

export interface CallupInput {
  player_id: number;
  level: CallupLevel;
  window_start: string;
  window_end: string | null;
  source_url: string;
}

export interface TvRightInput {
  competition_id: number;
  network: string;
  url: string | null;
  valid_from: string;
  valid_to: string | null;
  notes: string | null;
}

export interface TvRightRow extends TvRightInput {
  id: number;
  competition: string;
}

export interface CorrectionRow {
  id: number;
  page_url: string | null;
  message: string;
  status: CorrectionStatus;
  created_at: Timestamp;
}

export interface DashboardCounts {
  players_men: number;
  players_women: number;
  players_active: number;
  players_eligible: number;
  players_without_team: number;
  tracked_matches_next_7_days: number;
  open_corrections: number;
  /** Recent matches the provider stopped returning (usually rescheduled). */
  missing_matches: number;
  matches_updated_at: Timestamp | null;
}

export interface JobRunRow {
  id: number;
  job: string;
  started_at: Timestamp;
  finished_at: Timestamp | null;
  ok: boolean | null;
  calls: number;
  detail: string | null;
}

export interface MetricRow {
  day: string;
  metric: string;
  value: number;
}

export interface Dashboard {
  counts: DashboardCounts;
  jobRuns: JobRunRow[];
  metrics: MetricRow[];
}

// ---- Ingest ---------------------------------------------------------------------

/** A player a provider's squad list treats as U.S.-eligible. */
export interface ProviderPlayer {
  externalId: string;
  name: string;
  pool: Pool;
  position: string | null;
  birthDate: string | null;
  /** Shown on the player's page, e.g. "Nationality listed as USA by football-data.org". */
  eligibilitySource: string;
  /** The squad's team. */
  team: ProviderTeam;
}

/** One batch of squad lists: every team fetched, and the eligible players in them. */
export interface ProviderSquads {
  teams: ProviderTeam[];
  players: ProviderPlayer[];
}

/** The date range a sync asked the provider for (YYYY-MM-DD, inclusive). */
export interface SyncWindow {
  from: string;
  to: string;
}

export interface ProviderTeam {
  externalId: string;
  name: string;
  shortName: string | null;
  /** https URL of the team's crest image, if the provider has one. */
  crestUrl?: string | null;
}

export interface ProviderMatch {
  externalId: string;
  competitionCode: string;
  kickoffUtc: string;
  /** False when the provider has a date but no confirmed kickoff time yet. */
  kickoffConfirmed: boolean;
  status: MatchStatus;
  home: ProviderTeam;
  away: ProviderTeam;
  homeScore: number | null;
  awayScore: number | null;
}
