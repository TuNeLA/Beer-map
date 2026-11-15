-- 0523 (lane srv1): the drink cool-down comes from olnu_cooldown() (setting row, default 10 minutes).
-- LOCAL / CI copy only (rh_lf). One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0523_cooldown_setting.sql -f supabase/tests/cooldown-0523.test.sql
-- Old code proof: -v mig=/dev/null → the "setting" lines print |f| (no olnu_cooldown, the setting does nothing).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "cooldown-0523 done|t|".
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES ('00000000-0000-4000-8000-0000000523a1', 'authenticated', 'authenticated', true);
CREATE OR REPLACE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE p_sql INTO r;
  RETURN coalesce(r, 'null');
EXCEPTION WHEN others THEN
  RETURN 'ERR:' || sqlerrm;
END $$;
CREATE TEMP TABLE r (k text, v text);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000523a1","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000523a1', true) \g /dev/null

-- 1. no setting row (= live): 10 minutes, as before
INSERT INTO r SELECT 'def', pg_temp.try($q$select public.olnu_cooldown()::text$q$);
SELECT 'default: olnu_cooldown() is 10 minutes with no row', v = '00:10:00', v FROM r WHERE k = 'def';
INSERT INTO r SELECT 'b1', pg_temp.try($q$select public.post_beer_v2(60.15, 15.19, false, false)::text$q$);
INSERT INTO r SELECT 'b2', pg_temp.try($q$select public.post_beer_v2(60.15, 15.19, false, false)::text$q$);
SELECT 'default: beer 1 is accepted', v ~ '"accepted": true', left(v, 80) FROM r WHERE k = 'b1';
SELECT 'default: beer 2 at once is refused, wait about 600 s', v ~ '"accepted": false' AND (v::jsonb ->> 'wait_seconds')::int BETWEEN 590 AND 600, left(v, 120) FROM r WHERE k = 'b2';
INSERT INTO r SELECT 'p1', (public.poll_v2(60.0, 15.0, 60.3, 15.4, null, false)::jsonb -> 'me' ->> 'wait_seconds');
SELECT 'default: poll_v2 me.wait_seconds is about 600', v::int BETWEEN 590 AND 600, v FROM r WHERE k = 'p1';
INSERT INTO r SELECT 'o1', pg_temp.try($q$select public.post_other_v2('vin', 60.15, 15.19, false)::text$q$);
INSERT INTO r SELECT 'o2', pg_temp.try($q$select public.post_other_v2('vin', 60.15, 15.19, false)::text$q$);
SELECT 'default: other drink 2 at once is refused', (SELECT v FROM r WHERE k = 'o1') ~ '"accepted": true' AND v ~ '"accepted": false', left(v, 100) FROM r WHERE k = 'o2';

-- 2. the staging row: 0 seconds = no cool-down
INSERT INTO r SELECT 'set0', pg_temp.try($q$insert into public.olnu_server_settings (key, value) values ('drink_cooldown_seconds', '0') returning value$q$);
INSERT INTO r SELECT 'cd0', pg_temp.try($q$select public.olnu_cooldown()::text$q$);
SELECT 'setting 0: olnu_cooldown() is 0', v = '00:00:00', v FROM r WHERE k = 'cd0';
INSERT INTO r SELECT 'b3', pg_temp.try($q$select public.post_beer_v2(60.15, 15.19, false, false)::text$q$);
SELECT 'setting 0: the next beer at once is accepted', v ~ '"accepted": true', left(v, 80) FROM r WHERE k = 'b3';
INSERT INTO r SELECT 'o3', pg_temp.try($q$select public.post_other_v2('vin', 60.15, 15.19, false)::text$q$);
SELECT 'setting 0: the next other drink at once is accepted', v ~ '"accepted": true', left(v, 80) FROM r WHERE k = 'o3';
INSERT INTO r SELECT 'p0', (public.poll_v2(60.0, 15.0, 60.3, 15.4, null, false)::jsonb -> 'me' ->> 'wait_seconds');
SELECT 'setting 0: poll_v2 me.wait_seconds is 0', v = '0', v FROM r WHERE k = 'p0';

-- 3. another value, and a bad value falls back to 10 minutes
UPDATE public.olnu_server_settings SET value = '90' WHERE key = 'drink_cooldown_seconds';
INSERT INTO r SELECT 'b4', pg_temp.try($q$select public.post_beer_v2(60.15, 15.19, false, false)::text$q$);
SELECT 'setting 90: the next beer waits about 90 s', v ~ '"accepted": false' AND (v::jsonb ->> 'wait_seconds')::int BETWEEN 85 AND 90, left(v, 120) FROM r WHERE k = 'b4';
UPDATE public.olnu_server_settings SET value = 'off' WHERE key = 'drink_cooldown_seconds';
INSERT INTO r SELECT 'bad', pg_temp.try($q$select public.olnu_cooldown()::text$q$);
SELECT 'bad value: 10 minutes', v = '00:10:00', v FROM r WHERE k = 'bad';
SELECT 'cooldown-0523 done', true, '';
ROLLBACK;
