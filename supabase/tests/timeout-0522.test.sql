-- 0522 (lane srv1): statement_timeout is set to 20 s only for an API role that has none.
-- LOCAL / CI copy only. One transaction, ROLLBACK at the end (ALTER ROLE rolls back too).
-- usage: psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0522_role_timeout.sql -f supabase/tests/timeout-0522.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "timeout-0522 done|t|".
\pset format unaligned
\pset tuples_only on
BEGIN;
ALTER ROLE anon RESET statement_timeout;
ALTER ROLE authenticated SET statement_timeout = '8s';
\i :mig
\i :mig
SELECT 'a role with no limit gets 20 s', coalesce(rolconfig::text, '') ~ 'statement_timeout=20s', coalesce(rolconfig::text, '') FROM pg_roles WHERE rolname = 'anon';
SELECT 'a role with its own limit keeps it (8 s)', rolconfig::text ~ 'statement_timeout=8s' AND rolconfig::text !~ '20s', rolconfig::text FROM pg_roles WHERE rolname = 'authenticated';
SELECT 'timeout-0522 done', true, '';
ROLLBACK;
