-- 0519 (lane srv1): a flood of wrong owner keys cannot lock the owner out; wrong keys are limited per caller IP.
-- LOCAL / CI / staging copy. One transaction, ROLLBACK at the end (the test key exists only inside it). Runs the migration twice.
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0519_owner_key_lockout.sql -f supabase/tests/ownerkey-0519.test.sql
-- Old code proof: -v mig=/dev/null → the "flood" lines print |f| (rate_limited for the correct key).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "ownerkey-0519 done|t|".
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
CREATE OR REPLACE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE p_sql INTO r;
  RETURN coalesce(r, 'null');
EXCEPTION WHEN others THEN
  RETURN 'ERR:' || sqlerrm;
END $$;
CREATE TEMP TABLE r (k text, v text);
-- a test key that lives only in this transaction
INSERT INTO public.owner_keys (key_hash) VALUES (encode(extensions.digest('test-key-0519-only-in-this-transaction', 'sha256'), 'hex'));
UPDATE public.owner_key_fails SET at = now() - interval '2 hours';   -- old rows out of the 1 hour window (rolled back)

-- 1. the owner, IP 10.19.0.1, correct key
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.19.0.1"}', true) \g /dev/null
INSERT INTO r SELECT 'ok0', pg_temp.try($q$select public.olnu_wd_owner_ok('test-key-0519-only-in-this-transaction')::text$q$);
SELECT 'correct key works', v = 'true', v FROM r WHERE k = 'ok0';

-- 2. a flood: 1500 wrong keys in the last hour from 75 other callers (the old global limit was 1000)
INSERT INTO public.owner_key_fails (at, bucket) SELECT now() - interval '5 minutes', 'k:flood' || (g % 75) FROM generate_series(1, 1500) g;
INSERT INTO r SELECT 'flood_ok', pg_temp.try($q$select public.olnu_wd_owner_ok('test-key-0519-only-in-this-transaction')::text$q$);
SELECT 'flood: the correct key still works (olnu_wd_owner_ok)', v = 'true', v FROM r WHERE k = 'flood_ok';
INSERT INTO r SELECT 'flood_ms', pg_temp.try($q$select (public.owner_move_stats('test-key-0519-only-in-this-transaction') ? 'tickets')::text$q$);
SELECT 'flood: the correct key still works (owner_move_stats)', v = 'true', v FROM r WHERE k = 'flood_ms';
INSERT INTO r SELECT 'flood_st', pg_temp.try($q$select (public.owner_stats('test-key-0519-only-in-this-transaction')::jsonb ->> 'code' is distinct from 'PT403')::text$q$);
SELECT 'flood: the correct key still works (owner_stats)', v = 'true', left(v, 80) FROM r WHERE k = 'flood_st';
INSERT INTO r SELECT 'flood_bad', pg_temp.try($q$select public.olnu_wd_owner_ok('wrong-key')::text$q$);
SELECT 'flood: a wrong key is limited while the flood is on', v ~ 'rate_limited', v FROM r WHERE k = 'flood_bad';
UPDATE public.owner_key_fails SET at = now() - interval '2 hours' WHERE bucket LIKE 'k:flood%';

-- 3. one caller (IP 10.19.0.2, signed in as a new user each time) sends 21 wrong keys: the IP is limited, not the user
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.19.0.2"}', true) \g /dev/null
INSERT INTO r SELECT 'w' || g, pg_temp.try(format($q$select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000005190%s","role":"authenticated"}', true), public.olnu_wd_owner_ok('wrong-%s')::text$q$, lpad(g::text, 2, '0'), g))
  FROM generate_series(1, 21) g;
SELECT 'wrong key: 21 tries are counted (answers were false, not an error)', count(*) = 21, count(*)::text FROM public.owner_key_fails WHERE at > now() - interval '1 minute' AND bucket = 'k:' || md5('olnu-gw|10.19.0.2');
INSERT INTO r SELECT 'w22', pg_temp.try($q$select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000519099","role":"authenticated"}', true), public.olnu_wd_owner_ok('wrong-22')::text$q$);
SELECT 'wrong key: try 22 from the same IP (a new user) says rate_limited', v ~ 'rate_limited', v FROM r WHERE k = 'w22';
INSERT INTO r SELECT 'same_ip_ok', pg_temp.try($q$select public.olnu_wd_owner_ok('test-key-0519-only-in-this-transaction')::text$q$);
SELECT 'wrong key: the correct key from that same IP still works', v = 'true', v FROM r WHERE k = 'same_ip_ok';
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.19.0.3"}', true), set_config('request.jwt.claims', '', true) \g /dev/null
INSERT INTO r SELECT 'other_ip', pg_temp.try($q$select public.olnu_wd_owner_ok('wrong-x')::text$q$);
SELECT 'wrong key: another IP gets the normal answer (false), not rate_limited', v = 'false', v FROM r WHERE k = 'other_ip';
SELECT 'no raw IP is stored in the new rows', count(*) = 0, count(*)::text FROM public.owner_key_fails WHERE at > now() - interval '1 minute' AND bucket ~ '10\.19\.';
SELECT 'ownerkey-0519 done', true, '';
ROLLBACK;
