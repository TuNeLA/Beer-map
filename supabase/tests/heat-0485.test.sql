-- 0485 (lane heat): anonymous heat = bars + town centres, no double glow. LOCAL / staging copy only. One transaction, ROLLBACK.
-- Needs: the schema + bars_lite / olnu_towns data (Ludvika, Falun, Borlänge, Mora, Rättvik, Leksand, Sandviken bars from
-- docs/bars.json + bars-extra.json, the 0018 towns). Runs 0485 twice. Old server: run with -v mig=/dev/null (checks FAIL).
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0485_heat_bars_towns.sql \
--          -v mig2=supabase/migrations/0486_heat_area_pins.sql -f supabase/tests/heat-0485.test.sql
-- mig2=/dev/null: 0485 only (the "0486 …" pin lines then FAIL: strangers still get the ~550 m grid pin).
-- Prints "name|ok|detail" lines; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
-- the crew trigger on beers is deferred: run it at once, else ALTER TABLE beers (0485) stops on pending trigger events
SET CONSTRAINTS ALL IMMEDIATE;
-- people: M viewer (own beer), G + L group mates of M, F friend of M, FO friend of M with "Bara vänner", S stranger viewer,
-- K blocked by S, GH Spökläge, CI check-in, B bar 90 m off, V village home, V2 village yesterday.
CREATE TEMP TABLE u (k text PRIMARY KEY, id uuid);
INSERT INTO u VALUES ('M','00000000-0000-4000-8000-000000048501'), ('G','00000000-0000-4000-8000-000000048502'),
  ('F','00000000-0000-4000-8000-000000048503'), ('FO','00000000-0000-4000-8000-000000048504'),
  ('S','00000000-0000-4000-8000-000000048505'), ('K','00000000-0000-4000-8000-000000048506'),
  ('GH','00000000-0000-4000-8000-000000048507'), ('CI','00000000-0000-4000-8000-000000048508'),
  ('B','00000000-0000-4000-8000-000000048509'), ('V','00000000-0000-4000-8000-000000048510'),
  ('L','00000000-0000-4000-8000-000000048511'), ('N','00000000-0000-4000-8000-000000048512'), ('D','00000000-0000-4000-8000-000000048513');
INSERT INTO auth.users (id, aud, role) SELECT id, 'authenticated', 'authenticated' FROM u;
CREATE OR REPLACE FUNCTION pg_temp.uid(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM u WHERE k = p $$;
CREATE OR REPLACE FUNCTION pg_temp.as_(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p IS NULL THEN '' ELSE json_build_object('sub', pg_temp.uid(p), 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(pg_temp.uid(p)::text, ''), true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.m(a float8, b float8, c float8, d float8) RETURNS float8 LANGUAGE sql AS
$$ SELECT sqrt(power((a - c) * 111195, 2) + power((b - d) * 111195 * cos(radians(a)), 2)) $$;
-- sum of heat_points weight within p_r metres of a spot, as viewer p
CREATE OR REPLACE FUNCTION pg_temp.hw(p text, la float8, ln float8, r float8) RETURNS float8 LANGUAGE plpgsql AS $$
DECLARE v float8;
BEGIN
  PERFORM pg_temp.as_(p);
  SELECT coalesce(sum(h.w), 0) INTO v FROM public.heat_points() h WHERE pg_temp.m(h.lat, h.lng, la, ln) <= r;
  RETURN v;
END $$;
-- a town centre of 0485 (false on an old server without the table)
CREATE OR REPLACE FUNCTION pg_temp.is_town(la float8, ln float8) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v boolean;
BEGIN
  IF to_regclass('public.olnu_heat_towns') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.olnu_heat_towns t WHERE t.active AND t.lat = $1 AND t.lng = $2)' INTO v USING la, ln;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.bar(p_id text) RETURNS TABLE(lat float8, lng float8) LANGUAGE sql AS
$$ SELECT b.lat, b.lng FROM public.bars_lite b WHERE b.id = p_id $$;
CREATE OR REPLACE FUNCTION pg_temp.beer(p text, la float8, ln float8, pr boolean, n int DEFAULT 1) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.beers (user_id, lat, lng, precise, beer_count, expires_at, beer_at)
  VALUES (pg_temp.uid(p), la, ln, pr, n, public.olnu_next_expiry(), now());
$$;
-- relations
INSERT INTO public.groups (id, name, code) VALUES ('00000000-0000-4000-8000-0000000485a1', 'heat test', 'HEATZZ');
INSERT INTO public.group_members (group_id, user_id, display_name)
  SELECT '00000000-0000-4000-8000-0000000485a1', pg_temp.uid(k), k FROM u WHERE k IN ('M', 'G', 'L');
INSERT INTO public.friendships (a, b, requester, status, accepted_at)
  SELECT pg_temp.uid('M'), pg_temp.uid(k), pg_temp.uid('M'), 'accepted', now() FROM u WHERE k IN ('F', 'FO');
INSERT INTO public.olnu_visibility (user_id, friends_only) VALUES (pg_temp.uid('FO'), true);
INSERT INTO public.user_blocks (blocker, blocked) VALUES (pg_temp.uid('S'), pg_temp.uid('K'));

-- a beer from BEFORE the migration (event without bid): L (group mate of M) at Strikelounge Rättvik
SELECT pg_temp.beer('L', b.lat, b.lng, true) FROM pg_temp.bar('n12914116501') b;

\i :mig
\i :mig
\i :mig2
\i :mig2

-- tonight
SELECT pg_temp.beer('M', b.lat, b.lng, true) FROM pg_temp.bar('n5262504842') b;          -- Falun, The Bishop Arms
SELECT pg_temp.beer('G', b.lat, b.lng, true) FROM pg_temp.bar('n35176941') b;            -- Borlänge, Lion Bar
SELECT pg_temp.beer('F', b.lat, b.lng, true) FROM pg_temp.bar('n11094397888') b;         -- Mora, The Bishop Arms
SELECT pg_temp.beer('K', b.lat, b.lng, true) FROM pg_temp.bar('n282118837') b;           -- Sandviken, Mulligan's
SELECT pg_temp.beer('GH', b.lat, b.lng, true) FROM pg_temp.bar('n817725867') b;          -- Leksand, Fred's Burger
UPDATE public.beers SET ghost = true, stopped = true WHERE user_id = pg_temp.uid('GH');     -- later: Spökläge
SELECT pg_temp.beer('B', b.lat + 0.0008, b.lng, true, 5) FROM pg_temp.bar('n11081020004') b;  -- 89 m from Tiki Bar Rättvik, 5th beer
INSERT INTO public.checkins (user_id, bar_id, bar_name, lat, lng, expires_at)
  SELECT pg_temp.uid('CI'), 'x-la-parma-ludvika', 'La Parma', b.lat, b.lng, now() + interval '3 hours' FROM pg_temp.bar('x-la-parma-ludvika') b;
SELECT pg_temp.beer('CI', 60.150, 15.19, false);                                           -- not precise, checked in at La Parma
-- Ludvika centre weight for the stranger before / after the village beer and the "Bara vänner" beer
CREATE TEMP TABLE w (k text PRIMARY KEY, v float8);
INSERT INTO w SELECT 'lud0', pg_temp.hw('S', 60.1496, 15.1878, 1);
SELECT pg_temp.beer('V', 60.2050, 15.0300, true);                                          -- a home in a small village (no bars)
INSERT INTO w SELECT 'lud1', pg_temp.hw('S', 60.1496, 15.1878, 1);
SELECT pg_temp.beer('FO', b.lat, b.lng, true) FROM pg_temp.bar('x-lobbybaren-ludvika') b;  -- Ludvika, Lobbybaren, "Bara vänner"
INSERT INTO w SELECT 'lud2', pg_temp.hw('S', 60.1496, 15.1878, 1);
SELECT pg_temp.beer('N', 67.00, 16.50, true);
-- a driver's soda (ride3 'lask'): a drink row without beers + raw non-beer events, at Mora The Bear Pub (nobody else there)
INSERT INTO public.beers (user_id, lat, lng, precise, beer_count, other_count, other_kind, expires_at, other_at)
  SELECT pg_temp.uid('D'), b.lat, b.lng, true, 0, 1, 'lask', public.olnu_next_expiry(), now() FROM pg_temp.bar('n9559016508') b;
-- (beer_events.kind is checked today: each kind goes in only where the check allows it, e.g. after ride3 widens it)
DO $k$ DECLARE k text; BEGIN
  FOREACH k IN ARRAY ARRAY['shot', 'other', 'lask'] LOOP
    BEGIN
      INSERT INTO public.beer_events (kind, lat, lng, precise, n, expires_at)
        SELECT k, b.lat, b.lng, true, 1, public.olnu_next_expiry() FROM pg_temp.bar('n9559016508') b;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
END $k$;                                             -- far from any town with bars
-- yesterday (ghost_points2): a village beer, not precise
INSERT INTO public.beer_events (kind, lat, lng, precise, n, expires_at, created_at)
  VALUES ('beer', 60.050, 15.30, false, 1, now() - interval '30 hours', now() - interval '40 hours');

-- (1) village home: no heat within 2 km, the town centre (Ludvika) gets +1
SELECT 'village: stranger gets no heat within 2 km of the home', pg_temp.hw('S', 60.2050, 15.0300, 2000) = 0, pg_temp.hw('S', 60.2050, 15.0300, 2000)::text;
SELECT 'village: the group-less owner of the beer gets none either', pg_temp.hw('V', 60.2050, 15.0300, 2000) = 0, '';
SELECT 'village: Ludvika town centre weight +1', (SELECT v FROM w WHERE k = 'lud1') = (SELECT v FROM w WHERE k = 'lud0') + 1,
       (SELECT string_agg(k || '=' || v, ' ' ORDER BY k) FROM w);
-- (2) bar beer: heat at the bar (89 m off -> the 100 m rule), weight 2 for the 5th beer
SELECT 'bar: stranger gets weight 2 exactly at Tiki Bar', pg_temp.hw('S', b.lat, b.lng, 0.5) = 2, pg_temp.hw('S', b.lat, b.lng, 0.5)::text FROM pg_temp.bar('n11081020004') b;
SELECT 'bar: nothing at the raw spot 89 m away', pg_temp.hw('S', b.lat + 0.0008, b.lng, 30) = 0, '' FROM pg_temp.bar('n11081020004') b;
SELECT 'check-in: not precise beer -> heat at La Parma', pg_temp.hw('S', b.lat, b.lng, 0.5) = 1, '' FROM pg_temp.bar('x-la-parma-ludvika') b;
-- (3) no double glow: own / group mate / friend
SELECT 'own: M gets no heat for his own beer', pg_temp.hw('M', b.lat, b.lng, 300) = 0, '' FROM pg_temp.bar('n5262504842') b;
SELECT 'own: stranger S gets it', pg_temp.hw('S', b.lat, b.lng, 0.5) = 1, '' FROM pg_temp.bar('n5262504842') b;
SELECT 'mate: M gets no heat for G', pg_temp.hw('M', b.lat, b.lng, 300) = 0, '' FROM pg_temp.bar('n35176941') b;
SELECT 'mate: G gets none for himself either', pg_temp.hw('G', b.lat, b.lng, 300) = 0, '' FROM pg_temp.bar('n35176941') b;
SELECT 'mate: stranger S gets it', pg_temp.hw('S', b.lat, b.lng, 0.5) = 1, '' FROM pg_temp.bar('n35176941') b;
SELECT 'friend: M gets no heat for F', pg_temp.hw('M', b.lat, b.lng, 300) = 0, '' FROM pg_temp.bar('n11094397888') b;
SELECT 'friend: stranger S gets it', pg_temp.hw('S', b.lat, b.lng, 0.5) = 1, '' FROM pg_temp.bar('n11094397888') b;
SELECT 'legacy event (before 0485): M gets no heat for mate L', pg_temp.hw('M', b.lat, b.lng, 300) = 0, '' FROM pg_temp.bar('n12914116501') b;
SELECT 'legacy event: stranger S gets it at the bar', pg_temp.hw('S', b.lat, b.lng, 0.5) = 1, '' FROM pg_temp.bar('n12914116501') b;
-- (4) blocked: never (not the bar, not the town)
SELECT 'blocked: S gets nothing for K in Sandviken (bar or town)', pg_temp.hw('S', b.lat, b.lng, 3000) = 0, '' FROM pg_temp.bar('n282118837') b;
SELECT 'blocked: M (not blocked) gets K at the bar', pg_temp.hw('M', b.lat, b.lng, 0.5) = 1, '' FROM pg_temp.bar('n282118837') b;
-- (5) "Bara vänner": stranger only the town weight, friend nothing
SELECT 'Bara vänner: stranger gets no heat at Lobbybaren', pg_temp.hw('S', b.lat, b.lng, 0.5) = 0, '' FROM pg_temp.bar('x-lobbybaren-ludvika') b;
SELECT 'Bara vänner: stranger gets +1 at the Ludvika town centre', (SELECT v FROM w WHERE k = 'lud2') = (SELECT v FROM w WHERE k = 'lud1') + 1, '';
SELECT 'Bara vänner: friend M gets nothing for FO (no bar, Ludvika centre = village V only)',
       pg_temp.hw('M', b.lat, b.lng, 0.5) = 0 AND pg_temp.hw('M', 60.1496, 15.1878, 1) = (SELECT v FROM w WHERE k = 'lud1'), '' FROM pg_temp.bar('x-lobbybaren-ludvika') b;
-- (6) Spökläge: nowhere
SELECT 'Spökläge: no heat at the bar or in Leksand', pg_temp.hw('S', b.lat, b.lng, 5000) = 0, '' FROM pg_temp.bar('n817725867') b;
SELECT 'soda (lask / other): no heat at the bar', pg_temp.hw('S', b.lat, b.lng, 0.5) = 0, '' FROM pg_temp.bar('n9559016508') b;
SELECT 'soda (lask / other): Mora town centre gets nothing', pg_temp.hw('S', 61.0070, 14.5430, 1) = 0, '';
-- (7) only bars and town centres, ever
SELECT 'every heat point is a bar or a town centre', NOT EXISTS (
  SELECT 1 FROM public.heat_points() h
   WHERE NOT EXISTS (SELECT 1 FROM public.bars_lite b WHERE b.lat = h.lat AND b.lng = h.lng)
     AND NOT pg_temp.is_town(h.lat, h.lng)
     AND NOT EXISTS (SELECT 1 FROM public.checkins c WHERE c.lat = h.lat AND c.lng = h.lng)), '';
-- (8) the box versions (poll_v2 heat, poll_public heat) follow the same rules
SELECT pg_temp.as_('M');
SELECT 'poll_v2 M (Falun box): no heat at his own bar',
       NOT EXISTS (SELECT 1 FROM json_array_elements(public.poll_v2(60.59, 15.60, 60.62, 15.66, null, true) -> 'heat') x
                    WHERE pg_temp.m((x->>0)::float8, (x->>1)::float8, b.lat, b.lng) < 300), '' FROM pg_temp.bar('n5262504842') b;
SELECT pg_temp.as_('S');
SELECT 'poll_v2 S (Falun box): heat at the bar',
       EXISTS (SELECT 1 FROM json_array_elements(public.poll_v2(60.59, 15.60, 60.62, 15.66, null, true) -> 'heat') x
                WHERE pg_temp.m((x->>0)::float8, (x->>1)::float8, b.lat, b.lng) < 1), '' FROM pg_temp.bar('n5262504842') b;
SELECT pg_temp.as_(NULL);
SELECT 'poll_public (village box): no heat within 2 km of the home',
       NOT EXISTS (SELECT 1 FROM json_array_elements(public.poll_public(60.19, 15.00, 60.22, 15.06, true) -> 'heat') x
                    WHERE pg_temp.m((x->>0)::float8, (x->>1)::float8, 60.2050, 15.0300) < 2000), '';
SELECT 'poll_public (Ludvika box): La Parma + town centre, answer shape [lat,lng,w]',
       (SELECT count(*) FROM json_array_elements(public.poll_public(60.14, 15.17, 60.16, 15.20, true) -> 'heat') x
         WHERE json_array_length(x) = 3) >= 2, (public.poll_public(60.14, 15.17, 60.16, 15.20, true) -> 'heat')::text;
-- (9) yesterday's clouds
SELECT pg_temp.as_('S');
SELECT 'ghost_points2: no cloud within 2 km of yesterday''s village home',
       NOT EXISTS (SELECT 1 FROM public.ghost_points2() g WHERE pg_temp.m(g.lat, g.lng, 60.050, 15.30) < 2000), '';
SELECT 'ghost_points2: the village beer is a cloud at a town centre',
       EXISTS (SELECT 1 FROM public.ghost_points2() g WHERE pg_temp.is_town(g.lat, g.lng)), '';
SELECT 'ghost_points: same places', (SELECT count(*) FROM public.ghost_points()) = (SELECT count(*) FROM public.ghost_points2()), '';
-- (10) shapes + grants unchanged
SELECT 'shape: heat_points/olnu_heat/ghost_points2 result types',
       pg_get_function_result('public.heat_points()'::regprocedure) = 'TABLE(lat double precision, lng double precision, w double precision)'
   AND pg_get_function_result('public.olnu_heat(double precision,double precision,double precision,double precision,integer)'::regprocedure) = 'TABLE(lat double precision, lng double precision, w double precision)'
   AND pg_get_function_result('public.ghost_points2()'::regprocedure) = 'TABLE(lat double precision, lng double precision, w double precision, age_h double precision)', '';
SELECT 'grants: new helpers not callable by authenticated',
       to_regclass('public.olnu_heat_towns') IS NOT NULL
   AND NOT has_function_privilege('authenticated', coalesce(to_regprocedure('public.olnu_heat_rows(uuid,boolean,double precision,double precision,double precision,double precision)'), 'public.heat_points()'::regprocedure), 'execute')
   AND NOT has_table_privilege('authenticated', coalesce(to_regclass('public.olnu_heat_towns'), 'public.olnu_towns'::regclass), 'select')
   AND has_function_privilege('authenticated', 'public.heat_points()', 'execute'), '';
-- (11) 0486: strangers' pins of home beers at the town centre (pins = poll_v2 / poll_public / live_beers via olnu_pins)
CREATE OR REPLACE FUNCTION pg_temp.pins(p text) RETURNS TABLE(lat float8, lng float8, uid uuid, snap text) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_(p);
  RETURN QUERY SELECT x.lat, x.lng, b.user_id, x.snap FROM public.olnu_pins(pg_temp.uid(p), null, null, null, null) x JOIN public.beers b ON b.id = x.beer_id;
END $$;
SELECT '0486 stranger: the village pin is at the Ludvika town centre', EXISTS (SELECT 1 FROM pg_temp.pins('S') x WHERE x.uid = pg_temp.uid('V') AND x.lat = 60.1496 AND x.lng = 15.1878),
       (SELECT string_agg(x.lat || ',' || x.lng || ' ' || x.snap, ';') FROM pg_temp.pins('S') x WHERE x.uid = pg_temp.uid('V'));
SELECT '0486 stranger: no pin within 2 km of the village home', NOT EXISTS (SELECT 1 FROM pg_temp.pins('S') x WHERE pg_temp.m(x.lat, x.lng, 60.2050, 15.0300) < 2000), '';
SELECT '0486 stranger: a bar pin stays at the bar', EXISTS (SELECT 1 FROM pg_temp.pins('S') x, pg_temp.bar('n5262504842') b WHERE x.uid = pg_temp.uid('M') AND x.lat = b.lat AND x.lng = b.lng AND x.snap = 'bar'), '';
SELECT '0486 stranger: no town with bars in 60 km = no pin', NOT EXISTS (SELECT 1 FROM pg_temp.pins('S') x WHERE x.uid = pg_temp.uid('N')), '';
SELECT '0486 me: own pin exact, also far from towns', EXISTS (SELECT 1 FROM pg_temp.pins('N') x WHERE x.uid = pg_temp.uid('N') AND x.lat = 67.00 AND x.lng = 16.50), '';
SELECT '0486 me: own village pin exact', EXISTS (SELECT 1 FROM pg_temp.pins('V') x WHERE x.uid = pg_temp.uid('V') AND x.lat = 60.2050 AND x.lng = 15.0300), '';
SELECT '0486 mate: M sees G exact and once', (SELECT count(*) FROM pg_temp.pins('M') x WHERE x.uid = pg_temp.uid('G')) = 1, '';
SELECT '0486 box: poll_public (Ludvika box) has the village pin at the town centre, none near the home',
       EXISTS (SELECT 1 FROM json_array_elements(public.poll_public(60.14, 15.17, 60.16, 15.20, false) -> 'pins') x WHERE (x->>'lat')::float8 = 60.1496 AND (x->>'lng')::float8 = 15.1878)
   AND NOT EXISTS (SELECT 1 FROM json_array_elements(public.poll_public(60.19, 15.00, 60.22, 15.06, false) -> 'pins') x), '';
SELECT '0486 Bara vänner unchanged: S gets no pin for FO', NOT EXISTS (SELECT 1 FROM pg_temp.pins('S') x WHERE x.uid = pg_temp.uid('FO')), '';
SELECT '0486 marker', position('heat0486' in pg_get_functiondef('public.olnu_pins(uuid,double precision,double precision,double precision,double precision)'::regprocedure)) > 0, '';
ROLLBACK;
