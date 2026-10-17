-- v7: "Kaos i stan" pushes. Additive only (COMPATIBILITY RULES). Safe to re-run.
-- Old app versions keep working: no RPC, parameter or returned field changes.
--
-- 1. push_subscriptions gets an approximate home area (rounded to 0.01°, about 1 km).
--    Only the notify-group function (service role) reads it. Clients set it with set_push_location.
-- 2. push_sent caps area pushes to once per user per night. Old rows are cleaned up by the
--    edge function, not here.

alter table public.push_subscriptions add column if not exists lat float8;
alter table public.push_subscriptions add column if not exists lng float8;
alter table public.push_subscriptions add column if not exists loc_at timestamptz;
create index if not exists push_subscriptions_loc_idx
  on public.push_subscriptions (lat, lng) where lat is not null;

-- Area queries in notify-group filter live beers by a lat/lng box.
create index if not exists beers_lat_lng_idx on public.beers (lat, lng);

-- set_push_location: save the caller's approximate area on all of the caller's subscriptions.
-- Points outside Sweden (or not numbers) are ignored without an error.
create or replace function public.set_push_location(p_lat float8, p_lng float8)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < 55.0 or p_lat > 69.1 or p_lng < 10.9 or p_lng > 24.2 then
    return;
  end if;
  update public.push_subscriptions
     set lat = round(p_lat::numeric, 2)::float8,
         lng = round(p_lng::numeric, 2)::float8,
         loc_at = now()
   where user_id = v_uid;
end;
$$;

revoke all on function public.set_push_location(float8, float8) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.set_push_location(float8, float8) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.set_push_location(float8, float8) to authenticated';
  end if;
end $$;

-- push_sent: one row per (user, kind, night) when an area push was sent. kind = 'kaos'.
-- night = the beer's expires_at (the same 05:00 Europe/Stockholm expiry as beers).
create table if not exists public.push_sent (
  user_id uuid not null,
  kind    text not null,
  night   timestamptz not null,
  primary key (user_id, kind, night)
);
create index if not exists push_sent_night_idx on public.push_sent (night);
alter table public.push_sent enable row level security;
-- No policies: only the service role (edge function) touches this table.
revoke all on table public.push_sent from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.push_sent from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.push_sent from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.push_sent to service_role';
  end if;
end $$;
