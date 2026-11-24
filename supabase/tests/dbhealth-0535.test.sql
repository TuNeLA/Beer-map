-- 0535 (lane dbhealth): FK indexes + a primary key on the 4 log tables. No row changes.
-- LOCAL / CI copy only. One transaction, ROLLBACK at the end.
-- usage: psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0535_db_health.sql -f supabase/tests/dbhealth-0535.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "dbhealth-0535 done|t|".
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE c0535 AS
  SELECT (SELECT count(*) FROM public.join_fails) AS jf, (SELECT count(*) FROM public.owner_key_fails) AS ok,
         (SELECT count(*) FROM public.olnu_event_fix_log) AS ev;
INSERT INTO public.join_fails (user_id) VALUES ('00000000-0000-0000-0000-000000000535');
INSERT INTO public.olnu_event_fix_log (id, prev_status, reason) VALUES (535, 'ok', 'dbhealth test');
\i :mig
\i :mig
SELECT 'all 4 FK indexes exist', count(*) = 4, string_agg(t, ',') FROM unnest(array['app_feedback_user_id_idx',
  'pickup_answers_user_id_idx', 'olnu_zone_kommun_ln_idx', 'olnu_zone_poly_kn_idx']) t WHERE to_regclass('public.' || t) IS NOT NULL;
SELECT 'no FK without an index', count(*) = 0, coalesce(string_agg(c.conname, ','), '') FROM pg_constraint c
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
    AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]);
SELECT 'no table without a primary key', count(*) = 0, coalesce(string_agg(r.relname, ','), '') FROM pg_class r
  WHERE r.relkind = 'r' AND r.relnamespace = 'public'::regnamespace
    AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = r.oid AND k.contype = 'p');
SELECT 'old rows got a row_id', count(*) = 0, '' FROM public.join_fails WHERE row_id IS NULL;
SELECT 'two runs add one row_id column only', count(*) = 1, '' FROM pg_attribute
  WHERE attrelid = 'public.join_fails'::regclass AND attname LIKE 'row_id%' AND attnum > 0;
SELECT 'rows kept (no row lost)', (SELECT count(*) FROM public.join_fails) = jf + 1
  AND (SELECT count(*) FROM public.olnu_event_fix_log) = ev + 1 AND (SELECT count(*) FROM public.owner_key_fails) = ok, '' FROM c0535;
INSERT INTO public.join_fails (user_id) VALUES ('00000000-0000-0000-0000-000000000536');
INSERT INTO public.owner_key_fails (at) VALUES (now());
INSERT INTO public.olnu_event_fix_log (id, prev_status, reason) VALUES (536, 'ok', 'dbhealth test 2');
SELECT 'old insert code still works (named columns)', (SELECT count(*) FROM public.join_fails) = jf + 2
  AND (SELECT count(*) FROM public.owner_key_fails) = ok + 1, '' FROM c0535;
SELECT 'row_id is unique and grows', count(DISTINCT row_id) = count(*), '' FROM public.join_fails;
SELECT 'dbhealth-0535 done', true, '';
ROLLBACK;
