-- 0535 · Database health (lane dbhealth, PLAN C7, 24 Nov 2026). COORDINATOR-RUN, staging first.
-- What it adds (nothing existing changes; no function is replaced; no row is changed):
--   1. An index on each of the 4 foreign keys that have none (the server audit of 14 Nov, item 6):
--        app_feedback(user_id)    -> auth.users, the FK sets null when the user goes (an account erase scans the table without it)
--        pickup_answers(user_id)  -> auth.users, the FK removes the row when the user goes (same)
--        olnu_zone_kommun(ln)     -> olnu_zone_lan                  (small static table; the index makes the FK check cheap)
--        olnu_zone_poly(kn)       -> olnu_zone_kommun               (same)
--   2. A primary key on each log table that has none: join_fails, olnu_event_fix_log, owner_key_fails, and oi_hits
--      (0530, only where it exists). New column row_id bigint GENERATED ALWAYS AS IDENTITY + PRIMARY KEY (row_id).
--      Why: a table with no key cannot be cleaned or replicated row by row, and the advisor warns about it.
--      Safe: every INSERT into these tables names its columns (checked: grep "insert into public.<table>" in
--      supabase/migrations), no code reads them with SELECT * or to_jsonb(row), and only definer functions write them.
--      The column is added only to a table that has NO primary key yet (a second run changes nothing).
--   3. statement_timeout: NO change. 0522 (applied on live 15 Nov) already covers it: live anon = 3 s and
--      authenticated = 8 s (the Supabase defaults; STATE-history 15 Nov). The "2 min" in the audit is the postgres role
--      (cron jobs, the SQL editor): long jobs keep it. 15 to 20 s for the API roles would make today's limits WEAKER.
--   The 23 unused indexes are NOT in this file (no removal words in a migration): the owner list is in the lane report.
-- Lock: each ALTER TABLE takes a short exclusive lock on one small log table (a few hundred rows at most).
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_strip_cr (0436).
-- Check after the run (expect t, t, t, t, t):
--   select to_regclass('public.app_feedback_user_id_idx') is not null and to_regclass('public.pickup_answers_user_id_idx') is not null,
--     to_regclass('public.olnu_zone_kommun_ln_idx') is not null and to_regclass('public.olnu_zone_poly_kn_idx') is not null,
--     (select count(*) = 0 from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace
--        and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])),
--     (select count(*) = 0 from pg_class r where r.relkind = 'r' and r.relnamespace = 'public'::regnamespace
--        and not exists (select 1 from pg_constraint k where k.conrelid = r.oid and k.contype = 'p')),
--     (select count(*) = 0 from pg_attribute a where a.attname = 'row_id' and a.attidentity <> 'a'
--        and a.attrelid in (select to_regclass(t) from unnest(array['public.join_fails', 'public.olnu_event_fix_log',
--          'public.owner_key_fails', 'public.oi_hits']) t));

-- 1. Indexes for the foreign keys. Plain statements (scripts/db/objects.mjs reads them for the pre-apply snapshot).
create index if not exists app_feedback_user_id_idx on public.app_feedback (user_id);
create index if not exists pickup_answers_user_id_idx on public.pickup_answers (user_id);
create index if not exists olnu_zone_kommun_ln_idx on public.olnu_zone_kommun (ln);
create index if not exists olnu_zone_poly_kn_idx on public.olnu_zone_poly (kn);

-- 2. A primary key for the log tables that have none. The column first (safe to run twice), then the key, only where the
--    table has no primary key yet. All 4 tables exist on live and staging (oi_hits: 0530, live 19 Nov).
alter table public.join_fails add column if not exists row_id bigint generated always as identity;
alter table public.olnu_event_fix_log add column if not exists row_id bigint generated always as identity;
alter table public.owner_key_fails add column if not exists row_id bigint generated always as identity;
alter table public.oi_hits add column if not exists row_id bigint generated always as identity;
do $$
declare
  t text;
begin
  foreach t in array array['join_fails', 'olnu_event_fix_log', 'owner_key_fails', 'oi_hits'] loop
    if not exists (select 1 from pg_constraint k where k.conrelid = ('public.' || t)::regclass and k.contype = 'p') then
      execute format('alter table public.%I add constraint %I primary key (row_id)', t, t || '_pkey');
    end if;
  end loop;
end $$;

select public.olnu_strip_cr();
