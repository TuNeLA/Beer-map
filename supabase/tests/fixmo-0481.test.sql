-- 0481 (lane fixMo, N-06 / N-21 / N-19): after_report2 + olnu_mom_open read the crew clock. LOCAL / staging copy only.
-- One transaction, ROLLBACK at the end. Runs 0481 itself twice (2nd = skip). Needs 0450, 0451, 0453.
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0481_fixmo_crew_clock.sql -f supabase/tests/fixmo-0481.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail. Set -v old=1 to run the behaviour checks WITHOUT 0481 (they must fail).
\pset format unaligned
\pset tuples_only on
BEGIN;
INSERT INTO auth.users (id, aud, role) VALUES
  ('00000000-0000-4000-8000-000000048101', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000048102', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000048103', 'authenticated', 'authenticated');
CREATE OR REPLACE FUNCTION pg_temp.as_me() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000048101","role":"authenticated","is_anonymous":true}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000048101', true);
END $$;
-- a crew clock that is NOT real time: 20:00 Stockholm, 3 days from now (any test-kit offset looks like this)
CREATE OR REPLACE FUNCTION pg_temp.crew(p_min int) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT ((date_trunc('day', now() AT TIME ZONE 'Europe/Stockholm') + interval '3 days 20 hours') AT TIME ZONE 'Europe/Stockholm') + make_interval(mins => p_min);
$$;
SELECT 'before: after_report2 reads now()', position('v_now timestamptz := now();' in pg_get_functiondef('public.after_report2(uuid,timestamptz)'::regprocedure)) > 0, '';
SELECT 'before: Halvtid push says en minut', position('Svara på en minut' in pg_get_functiondef('public.olnu_mom_open(uuid,uuid)'::regprocedure)) > 0, '';
\if :{?old}
\else
\i :mig
\i :mig
SELECT 'marker after_report2', position('fixmo0481' in pg_get_functiondef('public.after_report2(uuid,timestamptz)'::regprocedure)) > 0, '';
SELECT 'marker olnu_mom_open', position('fixmo0481' in pg_get_functiondef('public.olnu_mom_open(uuid,uuid)'::regprocedure)) > 0, '';
SELECT 'Halvtid push: Svara inom en timme', position('Svara inom en timme' in pg_get_functiondef('public.olnu_mom_open(uuid,uuid)'::regprocedure)) > 0
   AND position('Svara på en minut' in pg_get_functiondef('public.olnu_mom_open(uuid,uuid)'::regprocedure)) = 0, '';
SELECT 'second run = skip', public.olnu_fixmo_patch('public.after_report2(uuid, timestamptz)', '/*fixmo0481*/', array['x'], array['y']) LIKE 'skip%', '';
\endif

-- after_report2 without a night: no crew setting = real time (the same answer as before for every normal user)
SELECT pg_temp.as_me();
SELECT 'after_report2: no crew clock = night of now() - 24 h (unchanged)',
  (public.after_report2() ->> 'night')::timestamptz = public.olnu_night_of(now() - interval '24 hours'), (public.after_report2() ->> 'night');
-- with a crew clock (the test kit): the night of crew - 24 h
SELECT set_config('olnu.crew_now', pg_temp.crew(9 * 60 + 1)::text, true);   -- 05:01 the next morning (crew)
SELECT 'after_report2: crew clock 05:01 = last night in the crew clock',
  (public.after_report2() ->> 'night')::timestamptz = public.olnu_night_of(pg_temp.crew(9 * 60 + 1) - interval '24 hours'),
  (public.after_report2() ->> 'night') || ' crew=' || pg_temp.crew(9 * 60 + 1)::text;

-- Uppdrag vid bordet: 3 checked in at the same bar, crew clock 20:00 → round 1; +2 min → still 1 (60-min gap); +61 → 2
INSERT INTO public.groups (id, name, code, created_by) VALUES ('00000000-0000-4000-8000-0000000481a0', 'Fixmogänget', 'FMXQ23', '00000000-0000-4000-8000-000000048101');
INSERT INTO public.group_members (group_id, user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000481a0', '00000000-0000-4000-8000-000000048101', 'Ada'),
  ('00000000-0000-4000-8000-0000000481a0', '00000000-0000-4000-8000-000000048102', 'Bo'),
  ('00000000-0000-4000-8000-0000000481a0', '00000000-0000-4000-8000-000000048103', 'Cia');
INSERT INTO public.after_flags (key, on_) VALUES ('moments', true) ON CONFLICT (key) DO UPDATE SET on_ = true;
SELECT set_config('olnu.crew_now', pg_temp.crew(0)::text, true);
INSERT INTO public.checkins (user_id, bar_id, bar_name, lat, lng, created_at, expires_at)
SELECT u, 'n-fixmo-bar', 'Fixmobaren', 60.15, 15.19, now(), pg_temp.crew(12 * 60)
  FROM unnest(array['00000000-0000-4000-8000-000000048101', '00000000-0000-4000-8000-000000048102', '00000000-0000-4000-8000-000000048103']::uuid[]) u;
SELECT public.olnu_mom_open('00000000-0000-4000-8000-0000000481a0', '00000000-0000-4000-8000-000000048101') >= 0;
SELECT 'bord: round 1 at crew 20:00', (SELECT count(*) FROM public.moment_rounds WHERE group_id = '00000000-0000-4000-8000-0000000481a0' AND kind = 'bord') = 1, '';
SELECT set_config('olnu.crew_now', pg_temp.crew(2)::text, true);
SELECT public.olnu_mom_open('00000000-0000-4000-8000-0000000481a0', '00000000-0000-4000-8000-000000048101') >= 0;
SELECT 'bord: no 2nd round 2 min later (60-min gap in the crew clock)', (SELECT count(*) FROM public.moment_rounds WHERE group_id = '00000000-0000-4000-8000-0000000481a0' AND kind = 'bord') = 1,
  (SELECT count(*) FROM public.moment_rounds WHERE group_id = '00000000-0000-4000-8000-0000000481a0' AND kind = 'bord')::text || ' rounds';
SELECT set_config('olnu.crew_now', pg_temp.crew(61)::text, true);
SELECT public.olnu_mom_open('00000000-0000-4000-8000-0000000481a0', '00000000-0000-4000-8000-000000048101') >= 0;
SELECT 'bord: round 2 after 61 min', (SELECT count(*) FROM public.moment_rounds WHERE group_id = '00000000-0000-4000-8000-0000000481a0' AND kind = 'bord') = 2, '';
-- live-like: no crew clock → the round start is created_at exactly (closes_at - 45 min = created_at)
SELECT 'bord: closes_at - 45 min = start in the crew clock', bool_and(r.closes_at - interval '45 minutes' = (SELECT pg_temp.crew(0)) OR r.closes_at - interval '45 minutes' = pg_temp.crew(61)), ''
  FROM public.moment_rounds r WHERE r.group_id = '00000000-0000-4000-8000-0000000481a0' AND r.kind = 'bord';
ROLLBACK;
