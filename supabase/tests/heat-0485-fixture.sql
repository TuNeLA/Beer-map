-- 0485/0486 (lane heat): makes tests/e2e/fixtures/heat-0485.json = what the SERVER answers one viewer (M), before and after.
-- LOCAL copy only (schema + release migrations + bars_lite / olnu_towns data). One transaction, ROLLBACK. Prints one JSON line.
-- usage (old):  psql "$DB" -X -At -v mig=/dev/null -v mig2=/dev/null -f supabase/tests/heat-0485-fixture.sql
-- usage (new):  psql "$DB" -X -At -v mig=supabase/migrations/0485_heat_bars_towns.sql -v mig2=supabase/migrations/0486_heat_area_pins.sql -f …
-- Ludvika: M (viewer) at Pitchers, G (M's group mate) at La Parma, X (stranger) at Lobbybaren, V (stranger) at home in a
-- village 10 km away (precise), Y (stranger) not precise in town.
\set QUIET on
\pset format unaligned
\pset tuples_only on
BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;
\i :mig
\i :mig2
CREATE TEMP TABLE u (k text PRIMARY KEY, id uuid);
INSERT INTO u VALUES ('M','00000000-0000-4000-8000-000000048601'), ('G','00000000-0000-4000-8000-000000048602'),
  ('X','00000000-0000-4000-8000-000000048603'), ('V','00000000-0000-4000-8000-000000048604'), ('Y','00000000-0000-4000-8000-000000048605');
INSERT INTO auth.users (id, aud, role) SELECT id, 'authenticated', 'authenticated' FROM u;
INSERT INTO public.groups (id, name, code) VALUES ('00000000-0000-4000-8000-0000000486a1', 'heat fixture', 'HEATFX');
INSERT INTO public.group_members (group_id, user_id, display_name)
  SELECT '00000000-0000-4000-8000-0000000486a1', id, CASE k WHEN 'M' THEN 'Anton' ELSE 'Lisa' END FROM u WHERE k IN ('M', 'G');
INSERT INTO public.beers (user_id, lat, lng, precise, beer_count, expires_at, beer_at)
SELECT u.id, v.lat, v.lng, v.pr, v.n, public.olnu_next_expiry(), now()
  FROM u JOIN (VALUES ('M', 60.14997::float8, 15.18679::float8, true, 3), ('G', 60.15124, 15.18797, true, 2),
                      ('X', 60.15098, 15.18663, true, 1), ('V', 60.2050, 15.0300, true, 1), ('Y', 60.155, 15.20, false, 1)) v(k, lat, lng, pr, n)
    ON v.k = u.k;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM u WHERE k = 'M'), 'role', 'authenticated')::text, true);
SELECT json_build_object(
  'server', CASE WHEN to_regclass('public.olnu_heat_towns') IS NULL THEN 'old' ELSE 'new' END,
  'live_beers', (SELECT json_agg(json_build_object('id', b.id, 'lat', b.lat, 'lng', b.lng, 'beer_count', b.beer_count, 'precise', b.precise,
                                                   'is_mine', b.is_mine, 'friend_name', b.friend_name, 'skal_count', 0, 'i_skaled', false) ORDER BY b.id)
                   FROM public.live_beers() b),
  'heat_points', (SELECT json_agg(json_build_object('lat', h.lat, 'lng', h.lng, 'w', h.w) ORDER BY h.lat, h.lng) FROM public.heat_points() h),
  'spots', json_build_object('me', json_build_array(60.14997, 15.18679), 'mate', json_build_array(60.15124, 15.18797),
                             'stranger_bar', json_build_array(60.15098, 15.18663), 'village_home', json_build_array(60.2050, 15.0300),
                             'town', json_build_array(60.1496, 15.1878)));
ROLLBACK;
