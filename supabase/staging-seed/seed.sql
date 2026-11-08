-- STAGING ONLY (pintsnow-staging, ref vdtmzsxajpvzwwbhnfmr). Never run on live (wcdskpcevbhouvbytkhv).
-- Base data for e2e tests that reach the staging server (PN_TARGET=staging, tests/e2e/serve.py).
-- Safe to run again: only INSERT ... ON CONFLICT DO NOTHING / WHERE NOT EXISTS. It never removes or changes other rows.
-- Data: public facts only (bar names + positions from OpenStreetMap, kommun outlines). No users' data.
--   bars:   the 4 Ludvika bars the mocked tests use (same ids) + 2 test bars in the test zone 68.35 / 18.80
--   zones:  län Dalarna (20) + Norrbotten (25), kommun Ludvika (2085) + Kiruna (2584), with simple outlines
--   events: one "Testquiz" at Testbaren that starts in 2 days (a new one is added when the last one has expired)
--   users:  the 4 fixed fake anonymous users from supabase/staging/seed.sql (test=true), if they are not there yet
-- Run: Supabase SQL editor or MCP execute_sql on the STAGING project. The guard below stops on any other project.

DO $$
BEGIN
  -- guard: the live project has 20 000+ real bars; staging has only seeded ones
  IF (SELECT count(*) FROM public.bars_lite) > 1000 THEN
    RAISE EXCEPTION 'staging-seed: this looks like LIVE (bars_lite has % rows). Stop.', (SELECT count(*) FROM public.bars_lite);
  END IF;
END $$;

-- 1. Bars
INSERT INTO public.bars_lite (id, name, lat, lng, type, active, updated_at) VALUES
  ('x-la-parma-ludvika',           'La Parma Pub & Restaurang',        60.15124, 15.18797, 'pub',        true, now()),
  ('n3472634175',                  'Pitchers',                         60.14997, 15.18679, 'pub',        true, now()),
  ('x-lobbybaren-ludvika',         'Lobbybaren (Grand Hotel Elektra)', 60.15098, 15.18663, 'bar',        true, now()),
  ('x-grekiska-grill-bar-ludvika', 'Grekiska Grill & Bar',             60.15205, 15.18059, 'restaurant', true, now()),
  ('test-bar-1',                   'Testbaren',                        68.35050, 18.80100, 'pub',        true, now()),
  ('test-bar-2',                   'Testpuben',                        68.35200, 18.79700, 'bar',        true, now())
ON CONFLICT (id) DO NOTHING;

-- 2. Zones (län → kommun → outline)
INSERT INTO public.olnu_zone_lan (ln, name) VALUES ('20', 'Dalarna'), ('25', 'Norrbotten')
ON CONFLICT (ln) DO NOTHING;
INSERT INTO public.olnu_zone_kommun (kn, ln, name) VALUES ('2085', '20', 'Ludvika'), ('2584', '25', 'Kiruna')
ON CONFLICT (kn) DO NOTHING;
INSERT INTO public.olnu_zone_poly (kn, bb, poly)
SELECT v.kn, v.bb::box, v.poly::polygon FROM (VALUES
  ('2085', '(15.252,60.41),(14.138,60.003)',
   '((14.635,60.285),(14.5255,60.2395),(14.3885,60.2625),(14.138,60.2445),(14.1865,60.176),(14.2155,60.0985),(14.4385,60.0255),(14.7455,60.003),(14.7175,60.0945),(14.846,60.1225),(14.853,60.086),(14.9235,60.061),(14.9935,60.0825),(15.0665,60.0695),(15.1245,60.025),(15.2235,60.1085),(15.252,60.1885),(15.239,60.283),(15.2005,60.307),(15.1485,60.3295),(15.0895,60.41),(15.007,60.3675),(14.812,60.3775),(14.699,60.287))'),
  ('2584', '(23.2805,69.048),(17.9455,67.3655)',
   '((23.2805,68.1595),(23.181,68.144),(23.1455,68.173),(23.1635,68.247),(23.0845,68.278),(23.0775,68.3135),(22.836,68.364),(22.6615,68.4195),(22.317,68.485),(22.126,68.4845),(22.03,68.4995),(22.014,68.556),(21.849,68.5985),(21.715,68.6015),(21.729,68.6335),(21.6245,68.6695),(21.4325,68.7025),(21.424,68.7655),(21.3045,68.769),(21.2435,68.821),(21.022,68.9035),(20.939,68.9005),(20.863,68.937),(20.942,68.977),(20.803,69.0295),(20.5935,69.048),(20.114,69.0295),(20.32,68.9115),(20.342,68.802),(20.2335,68.674),(20.0825,68.597),(19.952,68.5565),(20.2445,68.496),(19.913,68.3635),(18.9805,68.504),(18.6015,68.489),(18.3995,68.559),(18.1115,68.514),(18.09,68.3825),(18.166,68.169),(17.9455,67.978),(18.0105,67.936),(18.3525,67.8545),(18.89,67.8485),(19.0295,67.858),(19.351,67.8645),(19.4965,67.835),(19.8225,67.8),(20.027,67.7545),(20.1615,67.7545),(20.3935,67.7175),(20.7875,67.624),(21.0985,67.498),(21.432,67.486),(21.801,67.4615),(21.9255,67.42),(21.8865,67.394),(21.982,67.3655),(22.2065,67.5565),(22.4525,67.7415),(22.8025,67.836))')
) AS v(kn, bb, poly)
WHERE NOT EXISTS (SELECT 1 FROM public.olnu_zone_poly p WHERE p.kn = v.kn);

-- 3. One upcoming test event (expired ones stay; a new one is added only when none is current)
INSERT INTO public.bar_events (source, source_id, title, kind, starts_at, ends_at, expires_at, bar_id, place, lat, lng, town, status)
SELECT 'staging-seed', 'testquiz-' || to_char(now() + interval '2 days', 'YYYYMMDD'), 'Testquiz på Testbaren', 'quiz',
       date_trunc('hour', now() + interval '2 days'), date_trunc('hour', now() + interval '2 days 3 hours'),
       date_trunc('hour', now() + interval '2 days 6 hours'), 'test-bar-1', 'Testbaren', 68.3505, 18.8010, 'Kiruna', 'ok'
WHERE NOT EXISTS (SELECT 1 FROM public.bar_events WHERE source = 'staging-seed' AND expires_at > now());

-- 4. Fixed fake users (same as supabase/staging/seed.sql), only if missing
INSERT INTO auth.users (id, aud, role, is_anonymous, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
SELECT ('00000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', true,
       jsonb_build_object('test', 'true'), jsonb_build_object('provider', 'anonymous', 'providers', jsonb_build_array('anonymous')),
       now(), now()
FROM generate_series(1, 4) AS n
ON CONFLICT (id) DO NOTHING;

-- check
SELECT (SELECT count(*) FROM public.bars_lite WHERE id IN ('x-la-parma-ludvika','n3472634175','x-lobbybaren-ludvika','x-grekiska-grill-bar-ludvika','test-bar-1','test-bar-2')) AS bars_6,
       (SELECT count(*) FROM public.olnu_zone_poly WHERE kn IN ('2085','2584')) AS polys_2,
       (SELECT count(*) FROM public.bar_events WHERE source = 'staging-seed' AND expires_at > now()) AS events_now_1,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE '00000000-0000-4000-8000-00000000000_') AS users_4;
