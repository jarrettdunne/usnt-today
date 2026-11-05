-- Team crests (logos), as image URLs from the match data provider.
-- Filled in by the next match or squad sync; null until then, and the site shows
-- no image for a team without one.
alter table teams add column crest_url text;

-- Rendered as an <img src>, so only https URLs are allowed.
alter table teams add constraint teams_crest_url_https
  check (crest_url ~* '^https://');
