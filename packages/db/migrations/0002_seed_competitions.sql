-- The 12 competitions in football-data.org's free tier.
with c (name, country, code) as (
  values
    ('Premier League', 'England', 'PL'),
    ('Championship', 'England', 'ELC'),
    ('Bundesliga', 'Germany', 'BL1'),
    ('Serie A', 'Italy', 'SA'),
    ('La Liga', 'Spain', 'PD'),
    ('Ligue 1', 'France', 'FL1'),
    ('Eredivisie', 'Netherlands', 'DED'),
    ('Primeira Liga', 'Portugal', 'PPL'),
    ('Brasileirão Série A', 'Brazil', 'BSA'),
    ('UEFA Champions League', null, 'CL'),
    ('European Championship', null, 'EC'),
    ('FIFA World Cup', null, 'WC')
),
ins as (
  insert into competitions (name, country)
  select name, country from c
  returning id, name
)
insert into competition_provider_ids (provider, external_id, competition_id)
select 'football_data', c.code, ins.id
from c
join ins on ins.name = c.name;
