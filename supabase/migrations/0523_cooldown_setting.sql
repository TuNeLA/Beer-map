-- 0523 · the drink cool-down comes from one setting (lane srv1, server audit item 9, I-103). OWNER-RUN. Staging first.
-- A3-EXCEPTION: post_beer and post_other hold a row clean-up statement (its first word must not be in a migration file, also not in a function text), and poll_v2 is not the same text on live (before 0465) and in the release model. So the three changes are exact anchored patches (marker /*cd523*/) that land on both models. Coordinator dry-runs it on live in a rolled-back transaction first.
-- Check after the run (expect t, t, t, t):
--   select position('/*cd523*/' in pg_get_functiondef('public.post_beer(double precision, double precision, boolean)'::regprocedure)) > 0,
--     position('/*cd523*/' in pg_get_functiondef('public.post_other(text, double precision, double precision, boolean)'::regprocedure)) > 0,
--     position('/*cd523*/' in pg_get_functiondef('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)'::regprocedure)) > 0,
--     public.olnu_cooldown() = coalesce((select make_interval(secs => s.value::int) from public.olnu_server_settings s where s.key = 'drink_cooldown_seconds' and s.value ~ '^[0-9]{1,4}$'), interval '10 minutes');
--
-- Why: the owner wants no drink cool-down in the TEST build only. On 14 Nov the staging functions post_beer, post_other
-- and poll_v2 were changed by hand (10 minutes → 0 seconds). Staging and live then ran different function text, and
-- every staging test of the cool-down was wrong.
-- What changes: the three functions read the cool-down from public.olnu_cooldown().
--   olnu_cooldown() = the row 'drink_cooldown_seconds' of the new table olnu_server_settings (0 to 9999 seconds),
--   or 10 minutes when there is no row (or the value is not a number).
--   LIVE: this file makes NO row. The cool-down stays 10 minutes. Nothing changes for users.
--   STAGING: one row (made by hand, not by this file):
--     insert into public.olnu_server_settings (key, value) values ('drink_cooldown_seconds', '0')
--     on conflict (key) do update set value = excluded.value, updated_at = now();
-- Functions changed (snapshot these first = the rollback): post_beer(double precision, double precision, boolean),
--   post_other(text, double precision, double precision, boolean), poll_v2(double precision ×4, timestamp with time zone, boolean)
--   [anchored: 1 line, 1 line, 2 lines].
-- New: table olnu_server_settings (RLS on, no policy, no grant), function olnu_cooldown() (internal, no grant).
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_sec_patch (0430), olnu_strip_cr (0436).

create table if not exists public.olnu_server_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.olnu_server_settings enable row level security;
revoke all on table public.olnu_server_settings from public, anon, authenticated;

create or replace function public.olnu_cooldown()
returns interval language plpgsql stable set search_path = public as $$
declare
  v text;
begin
  select s.value into v from public.olnu_server_settings s where s.key = 'drink_cooldown_seconds';
  if v ~ '^[0-9]{1,4}$' then
    return make_interval(secs => v::int);
  end if;
  return interval '10 minutes';
end $$;
revoke all on function public.olnu_cooldown() from public, anon, authenticated;

select public.olnu_sec_patch('public.post_beer(double precision, double precision, boolean)', '/*cd523*/',
  array[$a$v_cooldown constant interval := interval '10 minutes';$a$],
  array[$a$v_cooldown constant interval := public.olnu_cooldown(); /*cd523*/$a$]);

select public.olnu_sec_patch('public.post_other(text, double precision, double precision, boolean)', '/*cd523*/',
  array[$a$v_cooldown constant interval := interval '10 minutes';$a$],
  array[$a$v_cooldown constant interval := public.olnu_cooldown(); /*cd523*/$a$]);

select public.olnu_sec_patch('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)', '/*cd523*/',
  array[$a$'wait_seconds', case when v_row.beer_count > 0 and v_row.beer_at > now() - interval '10 minutes'$a$,
        $a$then greatest(1, ceil(extract(epoch from (v_row.beer_at + interval '10 minutes' - now())))::int)$a$],
  array[$a$'wait_seconds', case when v_row.beer_count > 0 and v_row.beer_at > now() - public.olnu_cooldown() /*cd523*/$a$,
        $a$then greatest(1, ceil(extract(epoch from (v_row.beer_at + public.olnu_cooldown() - now())))::int)$a$]);

select public.olnu_strip_cr();
