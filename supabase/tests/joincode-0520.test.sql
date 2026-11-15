-- 0520 (lane srv1): group code guessing. Day limit per IP + global soft limit, on top of the 0510 limit (60 per IP per 10 min).
-- LOCAL / CI copy only (rh_lf, 0510 is in it). One transaction, ROLLBACK at the end. Runs the migration twice.
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0520_join_code_limit.sql -f supabase/tests/joincode-0520.test.sql
-- Old code proof: -v mig=/dev/null → the "day" and "global" lines print |f|.
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "joincode-0520 done|t|".
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES (p::uuid, 'authenticated', 'authenticated', true) ON CONFLICT DO NOTHING;
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
CREATE TEMP TABLE r (k text, v text);
SELECT pg_temp.as_u('00000000-0000-4000-8000-0000000520a1');
INSERT INTO r SELECT 'code', (public.create_group('Grp520', 'A520')::jsonb) ->> 'code';

-- 1. a real person: 3 wrong codes, then the correct one → in
SELECT pg_temp.as_u('00000000-0000-4000-8000-0000000520a2');
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.52.0.1"}', true) \g /dev/null
INSERT INTO r SELECT 'typo' || g, pg_temp.try(format($q$select public.join_group('ZZZZ%s', 'B520')::text$q$, g + 10)) FROM generate_series(1, 3) g;
INSERT INTO r SELECT 'real', pg_temp.try(format($q$select public.join_group(%L, 'B520')::text$q$, (SELECT v FROM r WHERE k = 'code')));
SELECT 'real person: 3 wrong codes, then the correct code works', v ~ 'Grp520', left(v, 100) FROM r WHERE k = 'real';
SELECT 'the wrong codes are counted per IP and in the global row', (SELECT bad FROM public.gw_link_hits WHERE k = 'j510:' || md5('olnu-gw|10.52.0.1') ORDER BY slot DESC LIMIT 1) = 3
       AND (SELECT sum(bad) FROM public.gw_link_hits WHERE k = 'j520:all') >= 3, '';

-- 2. the 0510 rule still holds: 60 wrong codes from one IP in this 10-minute slot → slow_down (a new user each time)
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.52.0.2"}', true) \g /dev/null
INSERT INTO public.gw_link_hits (k, slot, n, bad) VALUES ('j510:' || md5('olnu-gw|10.52.0.2'), floor(extract(epoch from now()) / 600)::bigint, 60, 60);
SELECT pg_temp.as_u('00000000-0000-4000-8000-0000000520a3');
INSERT INTO r SELECT 'ip60', pg_temp.try(format($q$select public.join_group(%L, 'C520')::text$q$, (SELECT v FROM r WHERE k = 'code')));
SELECT 'ip: 60 wrong codes in 10 minutes → slow_down (as 0510)', v ~ 'slow_down', left(v, 100) FROM r WHERE k = 'ip60';

-- 3. day limit: 200 wrong codes from one IP spread over the day (never 60 in one slot) → slow_down
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.52.0.3"}', true) \g /dev/null
INSERT INTO public.gw_link_hits (k, slot, n, bad)
  SELECT 'j510:' || md5('olnu-gw|10.52.0.3'), floor(extract(epoch from now()) / 600)::bigint - g, 50, 50 FROM generate_series(1, 4) g;
SELECT pg_temp.as_u('00000000-0000-4000-8000-0000000520a4');
INSERT INTO r SELECT 'day', pg_temp.try($q$select public.join_preview('QQQQQ1')::text$q$);
SELECT 'day: 200 wrong codes from one IP in 24 hours → slow_down', v ~ 'slow_down', left(v, 100) FROM r WHERE k = 'day';

-- 4. global soft limit: 400 wrong codes from many IPs in the last 10-20 minutes → an IP with 10 wrong codes is stopped,
--    an IP with 3 wrong codes still gets in with the correct code
INSERT INTO public.gw_link_hits (k, slot, n, bad) VALUES ('j520:all', floor(extract(epoch from now()) / 600)::bigint - 1, 400, 400)
  ON CONFLICT (k, slot) DO UPDATE SET bad = 400;
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.52.0.4"}', true) \g /dev/null
INSERT INTO public.gw_link_hits (k, slot, n, bad) VALUES ('j510:' || md5('olnu-gw|10.52.0.4'), floor(extract(epoch from now()) / 600)::bigint, 10, 10);
SELECT pg_temp.as_u('00000000-0000-4000-8000-0000000520a5');
INSERT INTO r SELECT 'glob10', pg_temp.try($q$select public.join_preview('QQQQQ2')::text$q$);
SELECT 'global: during mass guessing an IP with 10 wrong codes gets slow_down', v ~ 'slow_down', left(v, 100) FROM r WHERE k = 'glob10';
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.52.0.1"}', true) \g /dev/null
SELECT pg_temp.as_u('00000000-0000-4000-8000-0000000520a6');
INSERT INTO r SELECT 'glob3', pg_temp.try(format($q$select public.join_preview(%L)::text$q$, (SELECT v FROM r WHERE k = 'code')));
SELECT 'global: a person with 3 wrong codes still gets the group with the correct code', v ~ '"ok": true', left(v, 100) FROM r WHERE k = 'glob3';
SELECT 'joincode-0520 done', true, '';
ROLLBACK;
