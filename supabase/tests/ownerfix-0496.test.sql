-- 0496 (lane ownerfix): show_pin + price outliers. LOCAL / staging copy only. One transaction, ROLLBACK at the end.
-- Runs 0496 twice (idempotent). usage:
--   psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0496_ownerfix_pin_price.sql -f supabase/tests/ownerfix-0496.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
INSERT INTO auth.users (id, aud, role) VALUES
  ('00000000-0000-4000-8000-000000049601', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000049602', 'authenticated', 'authenticated');
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || p || '","role":"authenticated","is_anonymous":true}', true);
  PERFORM set_config('request.jwt.claim.sub', p, true);
END $$;
-- prices before 0496: a 290 kr typo pulls nothing (median of 3) but a lone one counts; record the old answer
INSERT INTO public.bar_prices (bar_id, user_id, kind, kr, day, bar_lat, bar_lng, updated_at)
SELECT 'of-bar-1', gen_random_uuid(), 'stor', k, current_date - i::int, 60.15, 15.18, now() - (i || ' hours')::interval
  FROM unnest(array[69, 72, 75, 290]) WITH ORDINALITY AS t(k, i);
SELECT 'before: 4 reports, typo inside the median', (public.olnu_aio_price('of-bar-1', 'stor') ->> 'n')::int = 4, public.olnu_aio_price('of-bar-1', 'stor')::text;
\i :mig
\i :mig
SELECT 'no CR in show_pin / olnu_aio_price', position(chr(13) in pg_get_functiondef('public.show_pin()'::regprocedure) || pg_get_functiondef('public.olnu_aio_price(text,text)'::regprocedure)) = 0, '';
-- price rules
SELECT 'outlier 290 not used (n = 3 of 4), median 72', (j ->> 'n')::int = 3 AND (j ->> 'kr')::int = 72 AND (j ->> 'all')::int = 4, j::text
  FROM (SELECT public.olnu_aio_price('of-bar-1', 'stor') AS j) x;
INSERT INTO public.bar_prices (bar_id, user_id, kind, kr, day, bar_lat, bar_lng) VALUES ('of-bar-2', gen_random_uuid(), 'stor', 25, current_date, 60.15, 15.18);
SELECT 'one report: used as it is (n = 1)', (j ->> 'n')::int = 1 AND (j ->> 'kr')::int = 25, j::text FROM (SELECT public.olnu_aio_price('of-bar-2', 'stor') AS j) x;
INSERT INTO public.bar_prices (bar_id, user_id, kind, kr, day, bar_lat, bar_lng) VALUES ('of-bar-2', gen_random_uuid(), 'stor', 80, current_date, 60.15, 15.18);
SELECT 'two reports: no outlier rule (n = 2)', (j ->> 'n')::int = 2, j::text FROM (SELECT public.olnu_aio_price('of-bar-2', 'stor') AS j) x;
INSERT INTO public.bar_prices (bar_id, user_id, kind, kr, day, bar_lat, bar_lng) VALUES ('of-bar-2', gen_random_uuid(), 'stor', 85, current_date, 60.15, 15.18);
SELECT 'three reports: the low 25 (< 0.5 x 82.5) is not used', (j ->> 'n')::int = 2 AND (j ->> 'kr')::int IN (82, 83), j::text FROM (SELECT public.olnu_aio_price('of-bar-2', 'stor') AS j) x;
INSERT INTO public.bar_prices (bar_id, user_id, kind, kr, day, bar_lat, bar_lng)
SELECT 'of-bar-3', gen_random_uuid(), 'stor', k, current_date, 60.15, 15.18 FROM unnest(array[60, 70, 80, 90, 100]) AS t(k);
SELECT 'no outlier: all 5 used, median 80', (j ->> 'n')::int = 5 AND (j ->> 'kr')::int = 80, j::text FROM (SELECT public.olnu_aio_price('of-bar-3', 'stor') AS j) x;
SELECT 'no reports: null', public.olnu_aio_price('of-bar-none', 'stor') IS NULL, '';
-- show_pin
INSERT INTO public.beers (user_id, lat, lng, precise, expires_at, beer_at, beer_count)
VALUES ('00000000-0000-4000-8000-000000049601', 60.15, 15.18, true, now() + interval '5 hours', now(), 3),
       ('00000000-0000-4000-8000-000000049602', 60.15, 15.18, true, now() + interval '5 hours', now(), 2);
SELECT pg_temp.as_u('00000000-0000-4000-8000-000000049601');
SELECT public.stop_beer();
SELECT 'stop_beer hides, the count stays', stopped AND beer_count = 3, '' FROM public.beers WHERE user_id = '00000000-0000-4000-8000-000000049601';
SELECT 'show_pin answers shown = true', (public.show_pin() ->> 'shown')::boolean, '';
SELECT 'show_pin: pin back, count unchanged', NOT stopped AND beer_count = 3, '' FROM public.beers WHERE user_id = '00000000-0000-4000-8000-000000049601';
SELECT 'show_pin twice: shown = false, no error', NOT (public.show_pin() ->> 'shown')::boolean, '';
UPDATE public.beers SET stopped = true, ghost = true WHERE user_id = '00000000-0000-4000-8000-000000049602';
SELECT pg_temp.as_u('00000000-0000-4000-8000-000000049602');
SELECT 'a ghost pin stays hidden', NOT (public.show_pin() ->> 'shown')::boolean, '';
SELECT 'ghost row untouched', stopped AND ghost, '' FROM public.beers WHERE user_id = '00000000-0000-4000-8000-000000049602';
SELECT 'only my own pin: user 1 untouched by user 2', NOT stopped, '' FROM public.beers WHERE user_id = '00000000-0000-4000-8000-000000049601';
SELECT 'grants: authenticated may run show_pin, anon may not',
  has_function_privilege('authenticated', 'public.show_pin()', 'execute') AND NOT has_function_privilege('anon', 'public.show_pin()', 'execute'), '';
ROLLBACK;
