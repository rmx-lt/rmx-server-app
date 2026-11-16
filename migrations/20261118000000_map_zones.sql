-- +goose Up
-- A map's `zones` became named parts that own `areas` (wiki Server-App,
-- "Planning API"). Maps stored in the old format (zones were polygons) are
-- deleted: development data, no migration. A map in the new format has a
-- first zone with `areas`, so this leaves those alone.
DELETE FROM maps WHERE NOT COALESCE(jsonb_path_exists(doc, '$.zones[0].areas'), false);
