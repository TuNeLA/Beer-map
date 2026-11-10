-- 0453 (followups): after_report2 + ride_awards → Kvällens chaufför. Local / staging test, one transaction, ROLLBACK.
-- Needs: schema + seed (supabase/staging/apply.mjs --seed), then 0420 and 0450. Runs 0453 itself (twice: 2nd = skip).
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0453_followups_ride_award.sql -f supabase/tests/followups-0453.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail.
BEGIN;
SELECT set_config('fu.gid', (SELECT id::text FROM public.groups WHERE name = 'Testgänget' ORDER BY created_at LIMIT 1), true);
SELECT set_config('fu.night', public.olnu_night_of(now() - interval '24 hours')::text, true);
-- last night: Ett (1) and Två (2) drank at a bar; Tre (3) drove 2 rides home and drank nothing; Två also has a ride row
-- but drank (never the driver); Fyra (4) is not a member (seed) so is never in the report.
UPDATE public.drink_log SET undone = true WHERE night = current_setting('fu.night')::timestamptz;
INSERT INTO public.drink_log (user_id, at, night, kind, bar_id, bar_name, lat, lng)
SELECT ('00000000-0000-4000-8000-00000000000' || n)::uuid, current_setting('fu.night')::timestamptz - interval '5 hours' + n * interval '10 minutes',
       current_setting('fu.night')::timestamptz, 'beer', 'test-bar-1', 'Testbaren', 68.3505, 18.8010
  FROM generate_series(1, 2) AS n;
INSERT INTO public.ride_awards (user_id, night, n, thanks) VALUES
  ('00000000-0000-4000-8000-000000000003', current_setting('fu.night')::timestamptz, 2, 1),
  ('00000000-0000-4000-8000-000000000002', current_setting('fu.night')::timestamptz, 1, 0)
ON CONFLICT (user_id, night) DO UPDATE SET n = excluded.n, thanks = excluded.thanks;

CREATE OR REPLACE FUNCTION pg_temp.rep() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
  r := public.after_report2(current_setting('fu.gid')::uuid, null);
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.who(r jsonb, nm text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT p FROM jsonb_array_elements(r -> 'people') p WHERE p ->> 'name' = nm LIMIT 1;
$$;

-- before 0453: Tre (drove, no drink) is missing; nobody has rides
SELECT 'before_tre_missing', pg_temp.who(pg_temp.rep(), 'Test Tre') IS NULL, coalesce(pg_temp.who(pg_temp.rep(), 'Test Tre')::text, 'absent');
SELECT 'before_no_rides_key', NOT (pg_temp.who(pg_temp.rep(), 'Test Två') ? 'rides'), left(pg_temp.who(pg_temp.rep(), 'Test Två')::text, 160);

\i :mig

SELECT 'after_tre_driver', (p ->> 'driver')::boolean AND (p ->> 'rides')::int = 2 AND (p ->> 'thanks')::int = 1 AND (p ->> 'out')::boolean = false,
       p::text FROM (SELECT pg_temp.who(pg_temp.rep(), 'Test Tre') AS p) x;
SELECT 'after_drinker_never_driver', (p ->> 'driver')::boolean = false AND (p ->> 'rides')::int = 0, p::text
  FROM (SELECT pg_temp.who(pg_temp.rep(), 'Test Två') AS p) x;
SELECT 'after_me_unchanged', (p ->> 'driver')::boolean = false AND (p ->> 'rides')::int = 0 AND (p ->> 'out')::boolean, left(p::text, 160)
  FROM (SELECT pg_temp.who(pg_temp.rep(), 'Test Ett') AS p) x;
SELECT 'after_counts', jsonb_array_length(pg_temp.rep() -> 'people') = 3, jsonb_array_length(pg_temp.rep() -> 'people')::text;
-- run again: skipped, same answer
\i :mig
SELECT 'rerun_same', (pg_temp.who(pg_temp.rep(), 'Test Tre') ->> 'rides')::int = 2, 'ok';
SELECT 'still_security_definer', p.prosecdef, p.proname FROM pg_proc p WHERE p.oid = 'public.after_report2(uuid, timestamptz)'::regprocedure;
ROLLBACK;
