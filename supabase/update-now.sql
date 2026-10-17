-- Öl Nu update 2026-10-17: 10 min between beers + push safety + heat map per beer + Kaos i stan pushes (area location, once per night). Paste ALL into Supabase → SQL Editor → Run. Safe to run again.

-- ===== supabase/migrations/0003_beer_cooldown.sql =====
-- Öl Nu: 10 min between beers. Beer only (shots were removed before they went live).
-- Additive. Safe to run again. Old app versions keep working (same name, params, return fields).
-- shot_count / shot_at stay as unused columns so 0005's trigger compiles on every database.
alter table public.beers add column if not exists shot_count int not null default 0;
alter table public.beers add column if not exists shot_at timestamptz;
alter table public.beers add column if not exists beer_at timestamptz;
update public.beers set beer_at = updated_at where beer_at is null and beer_count > 0;

create or replace function public.post_beer(p_lat float8, p_lng float8, p_precise bool)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_precise boolean := coalesce(p_precise, false);
  v_lat float8; v_lng float8;
  v_row public.beers%rowtype;
  v_is_new boolean := false;
  v_accepted boolean := true;
  v_wait int := 0;
  v_milestone int := null;
  v_cooldown constant interval := interval '10 minutes';
  v_last timestamptz;
begin
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < 55.0 or p_lat > 69.1 or p_lng < 10.9 or p_lng > 24.2 then
    raise exception 'outside_sweden';
  end if;
  if v_precise then
    v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
  else
    v_lat := (round(p_lat::numeric / 0.005) * 0.005)::float8; v_lng := (round(p_lng::numeric / 0.01) * 0.01)::float8;
  end if;
  delete from public.beers where user_id = v_uid and expires_at <= now();
  select * into v_row from public.beers where user_id = v_uid for update;
  if found then
    v_last := case when v_row.beer_count > 0 then coalesce(v_row.beer_at, v_row.updated_at) else null end;
    if v_last is not null and v_last > now() - v_cooldown then
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (v_last + v_cooldown - now())))::int);
    else
      update public.beers set lat = v_lat, lng = v_lng, precise = v_precise,
             beer_count = beer_count + 1, updated_at = now(), beer_at = now(), stopped = false
       where id = v_row.id returning * into v_row;
    end if;
  else
    insert into public.beers (user_id, lat, lng, precise, expires_at, beer_at)
    values (v_uid, v_lat, v_lng, v_precise, public.olnu_next_expiry(), now())
    on conflict (user_id) do nothing returning * into v_row;
    if v_row.id is not null then
      v_is_new := true;
    else
      select * into v_row from public.beers where user_id = v_uid;
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (coalesce(v_row.beer_at, v_row.updated_at) + v_cooldown - now())))::int);
    end if;
  end if;
  if v_accepted and v_row.beer_count in (1, 5, 10) then v_milestone := v_row.beer_count; end if;
  return json_build_object('accepted', v_accepted, 'wait_seconds', v_wait, 'id', v_row.id,
    'lat', v_row.lat, 'lng', v_row.lng, 'beer_count', v_row.beer_count, 'is_new', v_is_new,
    'expires_at', v_row.expires_at, 'milestone', v_milestone);
end; $$;

revoke all on function public.post_beer(float8, float8, bool) from public, anon;
grant execute on function public.post_beer(float8, float8, bool) to authenticated;

-- ===== supabase/migrations/0004_review_fixes.sql =====
-- Öl Nu: review fixes. Additive. Safe to run again. Run after 0003_beer_cooldown.sql.
-- 1. save_push_subscription: only accept https push endpoints. The notify-group function
--    POSTs to every saved endpoint, so a fake endpoint (http://..., internal hosts) must not be stored.
--    Same name, same parameters, same return type, same error code as before.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if coalesce(btrim(p_endpoint), '') = '' or coalesce(btrim(p_p256dh), '') = ''
     or coalesce(btrim(p_auth), '') = '' then
    raise exception 'invalid_subscription';
  end if;
  if char_length(p_endpoint) > 2000 or char_length(p_p256dh) > 500 or char_length(p_auth) > 500 then
    raise exception 'invalid_subscription';
  end if;
  if p_endpoint !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:443)?/' then
    raise exception 'invalid_subscription';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh  = excluded.p256dh,
        auth    = excluded.auth;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.save_push_subscription(text, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.save_push_subscription(text, text, text) to authenticated';
  end if;
end $$;

-- ===== supabase/migrations/0005_heat_events.sql =====
-- v6: heat map shows where each beer was drunk, not only where people are now.
-- Additive only (COMPATIBILITY RULES): new table, new trigger, new RPC. post_beer, post_shot and
-- live_beers are unchanged, so old app versions keep working. Safe to re-run.
--
-- Each accepted beer or shot adds one row to beer_events at the place it was logged.
-- The row has NO user_id: it is an anonymous dot for the heat map. Rows live until the
-- same 05:00 expiry as the beer pin.

create table if not exists public.beer_events (
  id         bigserial primary key,
  kind       text not null check (kind in ('beer', 'shot')),
  lat        float8 not null,
  lng        float8 not null,
  precise    boolean not null default false,
  n          int not null default 1,          -- beer number tonight (for streak weight); 0 for shots
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists beer_events_expires_idx on public.beer_events (expires_at);
alter table public.beer_events enable row level security;
-- No policies: only SECURITY DEFINER functions touch this table.
revoke all on table public.beer_events from public, anon, authenticated;

-- Trigger on beers: log a heat event when beer_count or shot_count goes up.
-- post_beer / post_shot delete an expired row before they insert a new one, so a new night
-- always starts with an INSERT.
create or replace function public.olnu_log_beer_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_beers int := 0;
  v_old_shots int := 0;
begin
  if tg_op = 'UPDATE' then
    v_old_beers := coalesce(old.beer_count, 0);
    v_old_shots := coalesce(old.shot_count, 0);
  end if;
  if coalesce(new.beer_count, 0) > v_old_beers then
    insert into public.beer_events (kind, lat, lng, precise, n, expires_at)
    values ('beer', new.lat, new.lng, coalesce(new.precise, false), new.beer_count, new.expires_at);
  end if;
  if coalesce(new.shot_count, 0) > v_old_shots then
    insert into public.beer_events (kind, lat, lng, precise, n, expires_at)
    values ('shot', new.lat, new.lng, coalesce(new.precise, false), 0, new.expires_at);
  end if;
  -- Light cleanup of old nights.
  if random() < 0.05 then
    delete from public.beer_events where expires_at < now() - interval '2 days';
  end if;
  return new;
end; $$;
revoke all on function public.olnu_log_beer_event() from public, anon, authenticated;

drop trigger if exists olnu_beer_event on public.beers;
create trigger olnu_beer_event
  after insert or update of beer_count, shot_count on public.beers
  for each row execute function public.olnu_log_beer_event();

-- heat_points: tonight's beers grouped into small map cells.
-- Precise events snap to about 55 m cells, approximate events keep their ~550 m grid.
-- Weight per beer: 1 (beers 1–4), 2 (HOT STREAK, 5–9), 3 (MEDEVAC, 10+). Shot = 0.5.
create or replace function public.heat_points()
returns table (lat float8, lng float8, w float8)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.olnu_uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select c.lat, c.lng, sum(c.w)::float8 as w
    from (
      select
        case when e.precise then (round(e.lat::numeric / 0.0005) * 0.0005)::float8 else e.lat end as lat,
        case when e.precise then (round(e.lng::numeric / 0.001) * 0.001)::float8 else e.lng end as lng,
        case when e.kind = 'shot' then 0.5
             when e.n >= 10 then 3
             when e.n >= 5 then 2
             else 1 end::float8 as w
      from public.beer_events e
      where e.expires_at > now()
    ) c
    group by c.lat, c.lng
    order by w desc
    limit 5000;
end; $$;
revoke all on function public.heat_points() from public, anon;
grant execute on function public.heat_points() to authenticated;

-- Seed tonight: one event per beer for pins that already exist, at their current place,
-- so the heat map is not empty right after the migration. Only runs when the table is empty.
insert into public.beer_events (kind, lat, lng, precise, n, expires_at)
select 'beer', b.lat, b.lng, b.precise, g.n, b.expires_at
from public.beers b
cross join lateral generate_series(1, greatest(b.beer_count, 0)) as g(n)
where b.expires_at > now() and not b.stopped
  and not exists (select 1 from public.beer_events);

-- ===== supabase/migrations/0006_push_nearby.sql =====
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
