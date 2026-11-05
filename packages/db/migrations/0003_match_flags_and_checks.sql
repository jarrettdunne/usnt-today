-- 1. Kickoff times the provider hasn't confirmed yet (football-data.org's SCHEDULED
--    status) are shown as "time to be confirmed" instead of as a real time.
alter table matches add column kickoff_confirmed boolean not null default true;

-- 2. Set when a sync no longer returns a match inside its date window, which
--    usually means it was rescheduled to a date outside the window. Hidden from
--    the public site until a later sync finds it again (and clears this).
alter table matches add column missing_since timestamptz;

-- 3. Links are rendered as hrefs, so only http(s) URLs are allowed.
--    NOT VALID: enforced for new and updated rows without failing on old ones.
alter table players add constraint players_eligibility_url_http
  check (eligibility_url ~* '^https?://') not valid;
alter table tv_rights add constraint tv_rights_url_http
  check (url ~* '^https?://') not valid;
alter table broadcasts add constraint broadcasts_url_http
  check (url ~* '^https?://') not valid;
alter table transfers add constraint transfers_source_url_http
  check (source_url ~* '^https?://') not valid;
alter table callups add constraint callups_source_url_http
  check (source_url ~* '^https?://') not valid;

-- 4. Date ranges must not end before they start.
alter table tv_rights add constraint tv_rights_dates_ordered
  check (valid_to is null or valid_to >= valid_from) not valid;
alter table callups add constraint callups_dates_ordered
  check (window_end is null or window_end >= window_start) not valid;

-- 5. Supports the corrections form's hourly cap.
create index corrections_created_idx on corrections (created_at desc);
