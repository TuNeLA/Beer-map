-- 0522 · statement_timeout for the API roles, only where none is set (lane srv1, server audit item 8). OWNER-RUN. Staging first.
-- Check after the run (expect t):
--   select (public.olnu_api_timeouts() ->> 'anon') is not null and (public.olnu_api_timeouts() ->> 'authenticated') is not null;
--
-- Why: the audit saw statement_timeout = 2 min (the database default). The app gives up after 15 s, so a stuck call
-- should not hold a connection for 2 minutes.
-- Measured on staging 15 Nov: the API roles already have their own limit there (anon 3 s, authenticated 8 s, the
-- Supabase defaults), and PostgREST uses them (the slowest call in pg_stat_statements is 7 998 ms for authenticated and
-- 2 486 ms for anon). The 2 min value is what the postgres role sees. 20 s would make those limits WEAKER.
-- So this file sets 20 s ONLY for a role (anon, authenticated) that has NO statement_timeout of its own.
--   Staging: nothing changes. Live: nothing changes when live has the Supabase defaults (read-only check:
--   select rolname, rolconfig from pg_roles where rolname in ('anon', 'authenticated', 'authenticator');).
-- The owner tools run as anon with a key: they keep the limit that anon has today.
-- New: olnu_api_timeouts() (internal, read only): the statement_timeout of anon / authenticated / authenticator as json,
-- for the check query here and for the owner (select public.olnu_api_timeouts();).
-- No other function and no table changes. olnu_town_of and the poll functions are NOT changed: see the lane report
-- (olnu_town_of costs 20 µs per call, no variant was faster; the polls take 1 to 9 ms on a warm connection, every
-- filter has its index; the slow means come from cold connections, not from query plans).
-- Rollback: alter role <name> reset statement_timeout; (only for a role that this file changed).
-- Additive. Safe to run twice. CR LF safe.

create or replace function public.olnu_api_timeouts()
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(r.rolname,
           (select substring(c from 'statement_timeout=(.*)') from unnest(coalesce(r.rolconfig, '{}'::text[])) c
             where c like 'statement_timeout=%' limit 1)), '{}'::jsonb)
    from pg_roles r where r.rolname in ('anon', 'authenticated', 'authenticator');
$$;
revoke all on function public.olnu_api_timeouts() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select x.rolname from pg_roles x
     where x.rolname in ('anon', 'authenticated')
       and not exists (select 1 from unnest(coalesce(x.rolconfig, '{}'::text[])) c where c like 'statement_timeout=%')
  loop
    execute format('alter role %I set statement_timeout = %L', r.rolname, '20s');
  end loop;
end $$;

notify pgrst, 'reload config';

select public.olnu_strip_cr();
