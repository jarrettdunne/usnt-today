-- Order of competitions on day pages, top first. Competitions without one go last,
-- alphabetically. Change the numbers here (in a new migration) to reorder.
alter table competitions add column display_order integer;

update competitions c
   set display_order = o.display_order
  from competition_provider_ids x
  join (values
    ('WC', 1), ('EC', 2), ('CL', 3),
    ('PL', 10), ('PD', 11), ('SA', 12), ('BL1', 13), ('FL1', 14), ('PPL', 15), ('DED', 16),
    ('BSA', 20), ('ELC', 21)
  ) as o (code, display_order) on o.code = x.external_id
 where x.provider = 'football_data'
   and x.competition_id = c.id;
