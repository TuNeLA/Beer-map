-- 0381 (bold, owner OK 2026-11-08): feature flags for the five "bold" features. ALL OFF until the big release.
-- The client (docs/js/bold.js) reads bold_flags_get() at sign-in and every 10 min. Missing RPC = all off.
-- Turn on (release-checklist.md):  update public.bold_flags set on_ = true, updated_at = now() where key = '<key>';
-- Kill switch:                     update public.bold_flags set on_ = false, updated_at = now() where key = '<key>';

create table if not exists public.bold_flags (
  key        text primary key,
  on_        boolean not null default false,
  note       text,
  updated_at timestamptz not null default now()
);
alter table public.bold_flags enable row level security;
revoke all on table public.bold_flags from public, anon, authenticated;

insert into public.bold_flags (key, on_, note) values
  ('bold_hemlage', false, 'Hem-läge: late-night screen (client only)'),
  ('bold_krog',    false, 'Kvällens krog: crown per town per night'),
  ('bold_skal_v2', false, 'Skåltimmen v2: Helg mode, in-app dual camera, collage'),
  ('bold_replay',  false, 'Kvällsrepris 2.0: 15 s player + video'),
  ('bold_bump',    false, 'Skål! bump + Nära dig nu')
on conflict (key) do nothing;

create or replace function public.bold_flags_get()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(f.key, f.on_), '{}'::jsonb) from public.bold_flags f;
$function$;

revoke all on function public.bold_flags_get() from public, anon;
grant execute on function public.bold_flags_get() to authenticated, service_role;
