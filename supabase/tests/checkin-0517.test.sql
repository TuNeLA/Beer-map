-- 0517 (lane srv1): a check-in at a place that is not proven is not shown to strangers.
-- LOCAL / CI copy only (rh_lf). One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0517_checkin_verify.sql -f supabase/tests/checkin-0517.test.sql
-- Old code proof: -v mig=/dev/null → the "fake" lines print |f| (the stranger gets the invented bar).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "checkin-0517 done|t|".
-- Users: A makes check-ins, B is a stranger, M is A's group mate. Places are outside the test zone (60.15 / 15.19).
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
-- 0534 (lane texts, 24 Nov): a NEW account now starts as "Bara vänner". These test people stand for accounts that
-- choose Alla (strangers may see them): replica mode keeps the 0534 trigger off for this insert only.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES
  ('00000000-0000-4000-8000-0000000517a1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000517a2', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000517a3', 'authenticated', 'authenticated', true);
SET LOCAL session_replication_role = origin;
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || p || '","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', p, true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE p_sql INTO r;
  RETURN coalesce(r, 'null');
EXCEPTION WHEN others THEN
  RETURN 'ERR:' || sqlerrm;
END $$;
-- the check-in rows one user gets: all three stranger-facing reads
CREATE OR REPLACE FUNCTION pg_temp.seen(p_bar text) RETURNS text LANGUAGE sql AS $$
  select concat_ws(',',
    case when (public.poll_v2(60.0, 15.0, 60.3, 15.4, null, false)::jsonb -> 'checkins') @> jsonb_build_array(jsonb_build_object('bar_id', p_bar)) then 'poll_v2' end,
    case when exists (select 1 from public.live_checkins() c where c.bar_id = p_bar) then 'live_checkins' end,
    case when (public.poll_public(60.0, 15.0, 60.3, 15.4, false)::jsonb -> 'checkins') @> jsonb_build_array(jsonb_build_object('bar_id', p_bar)) then 'poll_public' end);
$$;
CREATE TEMP TABLE r (k text, v text);
SELECT set_config('pn.a', '00000000-0000-4000-8000-0000000517a1', true), set_config('pn.b', '00000000-0000-4000-8000-0000000517a2', true),
       set_config('pn.m', '00000000-0000-4000-8000-0000000517a3', true) \g /dev/null
INSERT INTO public.bars_lite (id, name, lat, lng, type, active) VALUES ('t517-known', 'Known Bar 517', 60.15000, 15.19000, 'bar', true);

SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'grp', (public.create_group('Grp517', 'A517')::jsonb) ->> 'code';
SELECT pg_temp.as_u(current_setting('pn.m'));
SELECT public.join_group((SELECT v FROM r WHERE k = 'grp'), 'M517') IS NOT NULL \g /dev/null

-- 1. an invented bar: any id, a name with HTML, any point. A has no position on the server.
SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'fake', pg_temp.try($q$select public.check_in('t517-fake', '<b>Fake</b> 517', 60.21, 15.31)::text$q$);
SELECT 'fake: the check-in itself still works (ok true)', v ~ '"ok": true', left(v, 120) FROM r WHERE k = 'fake';
SELECT 'fake: the answer says verified false', v ~ '"verified": false', left(v, 120) FROM r WHERE k = 'fake';
SELECT 'fake: no < or > in the stored name', bar_name !~ '[<>]', bar_name FROM public.checkins WHERE user_id = current_setting('pn.a')::uuid;
INSERT INTO r SELECT 'fake_a', pg_temp.seen('t517-fake');
SELECT 'fake: A gets the own check-in (poll_v2, live_checkins)', v ~ 'poll_v2' AND v ~ 'live_checkins', v FROM r WHERE k = 'fake_a';
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'fake_m', pg_temp.seen('t517-fake');
SELECT 'fake: the group mate M gets it', v ~ 'poll_v2' AND v ~ 'live_checkins', v FROM r WHERE k = 'fake_m';
SELECT pg_temp.as_u(current_setting('pn.b'));
INSERT INTO r SELECT 'fake_b', pg_temp.seen('t517-fake');
SELECT 'fake: the stranger B gets it in no list', v = '', v FROM r WHERE k = 'fake_b';

-- 2. a known bar (bars_lite) at its place: proven, the name comes from the server
UPDATE public.checkins SET created_at = now() - interval '3 minutes' WHERE user_id = current_setting('pn.a')::uuid;
SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'known', pg_temp.try($q$select public.check_in('t517-known', 'Other name', 60.15040, 15.19050)::text$q$);
SELECT 'known: verified true and the server name', v ~ '"verified": true' AND v ~ 'Known Bar 517', left(v, 120) FROM r WHERE k = 'known';
SELECT pg_temp.as_u(current_setting('pn.b'));
INSERT INTO r SELECT 'known_b', pg_temp.seen('t517-known');
SELECT 'known: the stranger B gets it (all 3 lists)', v = 'poll_v2,live_checkins,poll_public', v FROM r WHERE k = 'known_b';

-- 3. the same place again (cool-down passed, another name sent): still proven, the proven name stays
UPDATE public.checkins SET created_at = now() - interval '3 minutes' WHERE user_id = current_setting('pn.a')::uuid;
UPDATE public.bars_lite SET active = false WHERE id = 't517-known';
SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'again', pg_temp.try($q$select public.check_in('t517-known', 'Evil <i>name</i>', 60.15040, 15.19050)::text$q$);
SELECT 'again: same proven place stays verified with the proven name', v ~ '"verified": true' AND v ~ 'Known Bar 517', left(v, 120) FROM r WHERE k = 'again';
UPDATE public.bars_lite SET active = true WHERE id = 't517-known';

-- 4. a known id but a point far from the bar: not proven
UPDATE public.checkins SET created_at = now() - interval '3 minutes' WHERE user_id = current_setting('pn.a')::uuid;
INSERT INTO r SELECT 'far', pg_temp.try($q$select public.check_in('t517-known', 'Known Bar 517', 60.25, 15.35)::text$q$);
SELECT 'far: a known id at another point is not verified', v ~ '"ok": true' AND v ~ '"verified": false', left(v, 120) FROM r WHERE k = 'far';

-- 5. a place the server does not know, but A has a fresh own position there (a beer): proven
UPDATE public.checkins SET created_at = now() - interval '3 minutes' WHERE user_id = current_setting('pn.a')::uuid;
INSERT INTO r SELECT 'beer', pg_temp.try($q$select public.post_beer_v2(60.1810, 15.2410, true, false)::text$q$);
INSERT INTO r SELECT 'near', pg_temp.try($q$select public.check_in('t517-new', 'New Place 517', 60.1820, 15.2420)::text$q$);
SELECT 'near: own position near the place makes it verified', v ~ '"verified": true', left(v, 120) FROM r WHERE k = 'near';
SELECT pg_temp.as_u(current_setting('pn.b'));
INSERT INTO r SELECT 'near_b', pg_temp.seen('t517-new');
SELECT 'near: the stranger B gets it', v ~ 'poll_v2', v FROM r WHERE k = 'near_b';

-- 6. the 2 minute cool-down answer is the same as before
SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'cool', pg_temp.try($q$select public.check_in('t517-known', 'Known Bar 517', 60.15, 15.19)::text$q$);
SELECT 'cool-down: ok false + wait_seconds as before', v ~ '"ok": false' AND v ~ 'wait_seconds', left(v, 120) FROM r WHERE k = 'cool';
SELECT 'checkin-0517 done', true, '';
ROLLBACK;
