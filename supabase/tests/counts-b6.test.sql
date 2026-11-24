-- B6 (lane dbhealth, PLAN B6, blind test 3): "three different counts after a beer in the mock". The real server must give
-- ONE number for tonight in all three places the app shows it:
--   1. post_beer_v2 / post_other_v2 answer .drinks  -> the count burst / the fact toast (app-beer.js beerDone, extras.js)
--   2. poll_v2 .me beer_count + other_count          -> the rail button #pn-mine and the Ikväll pill (app-hud.js, U.drinks)
--   3. my_night_log .stats.drinks                     -> the Min kväll sheet (nightlog.js)
-- LOCAL / CI copy only (rh_lf). One transaction, ROLLBACK at the end. No migration (mig is not used).
-- usage: psql -d rh_lf -X -v ON_ERROR_STOP=1 -f supabase/tests/counts-b6.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "counts-b6 done|t|".
\pset format unaligned
\pset tuples_only on
BEGIN;
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES ('00000000-0000-4000-8000-0000000000b6', 'authenticated', 'authenticated', true);
INSERT INTO public.olnu_server_settings (key, value) VALUES ('drink_cooldown_seconds', '0')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b6","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b6', true) \g /dev/null
CREATE TEMP TABLE c (step text, post int, poll int, nl int);
CREATE OR REPLACE FUNCTION pg_temp.snap(p_step text, p_post int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m jsonb; n jsonb;
BEGIN
  m := (public.poll_v2(60.10, 15.10, 60.20, 15.30, null, false)::jsonb) -> 'me';
  n := public.my_night_log(null)::jsonb;
  INSERT INTO c VALUES (p_step, p_post, coalesce((m ->> 'beer_count')::int, 0) + coalesce((m ->> 'other_count')::int, 0),
                        (n -> 'stats' ->> 'drinks')::int);
END $$;
SELECT pg_temp.snap('beer 1', (public.post_beer_v2(60.15, 15.19, true, false)::jsonb ->> 'drinks')::int) \g /dev/null
SELECT pg_temp.snap('beer 2', (public.post_beer_v2(60.15, 15.19, true, false)::jsonb ->> 'drinks')::int) \g /dev/null
SELECT pg_temp.snap('beer 3', (public.post_beer_v2(60.15, 15.19, true, false)::jsonb ->> 'drinks')::int) \g /dev/null
SELECT pg_temp.snap('other 1', (public.post_other_v2('vin', 60.15, 15.19, true)::jsonb ->> 'drinks')::int) \g /dev/null
SELECT public.undo_beer() \g /dev/null
SELECT pg_temp.snap('after undo', null) \g /dev/null
SELECT pg_temp.snap('ghost beer', (public.post_beer_v2(60.15, 15.19, true, true)::jsonb ->> 'drinks')::int) \g /dev/null
SELECT 'same count: ' || step, (post IS NULL OR post = poll) AND poll = nl, format('post=%s poll=%s nightlog=%s', post, poll, nl) FROM c ORDER BY ctid;
SELECT 'counts go 1, 2, 3, 4 then 3 after undo, 4 with a ghost beer',
       string_agg(poll::text, ',' ORDER BY ctid) = '1,2,3,4,3,4', string_agg(poll::text, ',' ORDER BY ctid) FROM c;
SELECT 'counts-b6 done', true, '';
ROLLBACK;
