-- Öl Nu: full database setup. Paste ALL of this into Supabase → SQL Editor → Run. Safe to run again.

-- ===== supabase/migrations/0001_olnu.sql =====
-- Öl Nu — schema, RLS and RPCs.
-- Binding spec: CONTRACT.md. All client access goes through the SECURITY DEFINER
-- RPCs below. Tables have RLS on and no policies, so direct table access is denied.

create extension if not exists pgcrypto;  -- gen_random_uuid() (built in on PG13+, harmless)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.beers (
  id          bigserial primary key,
  user_id     uuid not null unique,
  lat         float8 not null,
  lng         float8 not null,
  precise     boolean not null default false,
  beer_count  int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  stopped     boolean not null default false,
  notified_level int not null default 0
);

-- v2 upgrade path for databases made with the v1 schema.
alter table public.beers add column if not exists stopped boolean not null default false;
alter table public.beers add column if not exists notified_level int not null default 0;
alter table public.beers drop column if exists notified;

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  code        text not null unique check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id      uuid not null references public.groups(id) on delete cascade,
  user_id       uuid not null,
  display_name  text not null check (char_length(display_name) between 1 and 30),
  joined_at     timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists beers_expires_at_idx              on public.beers (expires_at);
create index if not exists group_members_user_id_idx         on public.group_members (user_id);
create index if not exists push_subscriptions_user_id_idx    on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- RLS: on, no policies. Also drop the default Supabase table grants.
-- ---------------------------------------------------------------------------

alter table public.beers              enable row level security;
alter table public.groups             enable row level security;
alter table public.group_members      enable row level security;
alter table public.push_subscriptions enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.beers, public.groups, public.group_members, public.push_subscriptions from anon';
    execute 'revoke all on sequence public.beers_id_seq, public.push_subscriptions_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.beers, public.groups, public.group_members, public.push_subscriptions from authenticated';
    execute 'revoke all on sequence public.beers_id_seq, public.push_subscriptions_id_seq from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (internal, not callable by clients)
-- ---------------------------------------------------------------------------

-- Next 05:00 Europe/Stockholm strictly after now().
create or replace function public.olnu_next_expiry()
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_local  timestamp := now() at time zone 'Europe/Stockholm';
  v_target timestamp := date_trunc('day', v_local) + interval '5 hours';
begin
  if v_local >= v_target then
    v_target := v_target + interval '1 day';
  end if;
  return v_target at time zone 'Europe/Stockholm';
end;
$$;

-- Trim + length check for display names. Raises invalid_name.
create or replace function public.olnu_clean_display_name(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := btrim(coalesce(p, ''));
begin
  if char_length(v) < 1 or char_length(v) > 30 then
    raise exception 'invalid_name';
  end if;
  return v;
end;
$$;

-- Caller uid or raise not_authenticated.
create or replace function public.olnu_uid()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not_authenticated';
  end if;
  return v;
end;
$$;

revoke all on function public.olnu_next_expiry()             from public;
revoke all on function public.olnu_clean_display_name(text)  from public;
revoke all on function public.olnu_uid()                     from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_next_expiry(), public.olnu_clean_display_name(text), public.olnu_uid() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_next_expiry(), public.olnu_clean_display_name(text), public.olnu_uid() from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- post_beer(p_lat, p_lng, p_precise) -> json
--   {accepted, wait_seconds, id, lat, lng, beer_count, is_new, expires_at, milestone}
-- 15 min cooldown per user. milestone = 1/5/10 when this accepted tap made
-- beer_count reach exactly that value.
drop function if exists public.post_beer(float8, float8, bool);
create or replace function public.post_beer(p_lat float8, p_lng float8, p_precise bool)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := public.olnu_uid();
  v_precise   boolean := coalesce(p_precise, false);
  v_lat       float8;
  v_lng       float8;
  v_row       public.beers%rowtype;
  v_is_new    boolean := false;
  v_accepted  boolean := true;
  v_wait      int := 0;
  v_milestone int := null;
  v_cooldown  constant interval := interval '15 minutes';
begin
  -- Finite numbers + Sweden bbox. (NaN/Infinity/null are all "outside".)
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < 55.0 or p_lat > 69.1
     or p_lng < 10.9 or p_lng > 24.2 then
    raise exception 'outside_sweden';
  end if;

  if v_precise then
    v_lat := round(p_lat::numeric, 5)::float8;
    v_lng := round(p_lng::numeric, 5)::float8;
  else
    v_lat := (round(p_lat::numeric / 0.005) * 0.005)::float8;
    v_lng := (round(p_lng::numeric / 0.01) * 0.01)::float8;
  end if;

  -- Drop caller's expired row so a new night starts fresh.
  delete from public.beers where user_id = v_uid and expires_at <= now();

  select * into v_row from public.beers where user_id = v_uid for update;

  if found then
    if v_row.updated_at > now() - v_cooldown then
      -- Cooldown: nothing changes (a stopped row stays stopped).
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (v_row.updated_at + v_cooldown - now())))::int);
    else
      -- Normal tap, also resumes a stopped row without resetting the count.
      update public.beers
         set lat = v_lat, lng = v_lng, precise = v_precise,
             beer_count = beer_count + 1, updated_at = now(), stopped = false
       where id = v_row.id
      returning * into v_row;
    end if;
  else
    insert into public.beers (user_id, lat, lng, precise, expires_at)
    values (v_uid, v_lat, v_lng, v_precise, public.olnu_next_expiry())
    on conflict (user_id) do nothing
    returning * into v_row;

    if v_row.id is not null then
      v_is_new := true;
    else
      -- Lost a race with a concurrent tap from the same user: return that row.
      select * into v_row from public.beers where user_id = v_uid;
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (v_row.updated_at + v_cooldown - now())))::int);
    end if;
  end if;

  if v_accepted and v_row.beer_count in (1, 5, 10) then
    v_milestone := v_row.beer_count;
  end if;

  return json_build_object(
    'accepted',     v_accepted,
    'wait_seconds', v_wait,
    'id',         v_row.id,
    'lat',        v_row.lat,
    'lng',        v_row.lng,
    'beer_count', v_row.beer_count,
    'is_new',     v_is_new,
    'expires_at', v_row.expires_at,
    'milestone',  v_milestone
  );
end;
$$;

-- stop_beer() -> void. Hides the pin; count is kept until the 05:00 expiry.
drop function if exists public.stop_beer();
create or replace function public.stop_beer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  update public.beers set stopped = true
   where user_id = v_uid and expires_at > now();
end;
$$;

-- live_beers() -> setof (id, lat, lng, beer_count, precise, created_at, is_mine, friend_name)
-- Excludes stopped and expired rows.
drop function if exists public.live_beers();
create or replace function public.live_beers()
returns table (
  id          bigint,
  lat         float8,
  lng         float8,
  beer_count  int,
  precise     bool,
  created_at  timestamptz,
  is_mine     bool,
  friend_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select b.id, b.lat, b.lng, b.beer_count, b.precise, b.created_at,
         (b.user_id = v_uid) as is_mine,
         case when b.user_id = v_uid then null
              else (select min(am.display_name)
                      from public.group_members am
                      join public.group_members cm
                        on cm.group_id = am.group_id and cm.user_id = v_uid
                     where am.user_id = b.user_id)
         end as friend_name
    from public.beers b
   where b.expires_at > now()
     and not b.stopped
   order by b.created_at;
end;
$$;

-- create_group(p_name, p_display_name) -> json {id, name, code}
create or replace function public.create_group(p_name text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.olnu_uid();
  v_name     text := btrim(coalesce(p_name, ''));
  v_display  text := public.olnu_clean_display_name(p_display_name);
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_id       uuid;
  v_try      int := 0;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;

  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;

    insert into public.groups (name, code, created_by)
    values (v_name, v_code, v_uid)
    on conflict (code) do nothing
    returning groups.id into v_id;

    exit when v_id is not null;
    if v_try >= 20 then
      raise exception 'code_generation_failed';
    end if;
  end loop;

  insert into public.group_members (group_id, user_id, display_name)
  values (v_id, v_uid, v_display);

  return json_build_object('id', v_id, 'name', v_name, 'code', v_code);
end;
$$;

-- join_group(p_code, p_display_name) -> json {id, name, code}
create or replace function public.join_group(p_code text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.olnu_uid();
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_display text := public.olnu_clean_display_name(p_display_name);
  v_group   public.groups%rowtype;
begin
  select * into v_group from public.groups g where g.code = v_code;
  if not found then
    raise exception 'group_not_found';
  end if;

  insert into public.group_members (group_id, user_id, display_name)
  values (v_group.id, v_uid, v_display)
  on conflict (group_id, user_id) do update set display_name = excluded.display_name;

  return json_build_object('id', v_group.id, 'name', v_group.name, 'code', v_group.code);
end;
$$;

-- leave_group(p_group_id) -> void; deletes the group when empty
create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  delete from public.group_members where group_id = p_group_id and user_id = v_uid;
  delete from public.groups g
   where g.id = p_group_id
     and not exists (select 1 from public.group_members m where m.group_id = p_group_id);
end;
$$;

-- my_groups() -> setof (id, name, code, member_count, active_count)
create or replace function public.my_groups()
returns table (
  id           uuid,
  name         text,
  code         text,
  member_count int,
  active_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select g.id, g.name, g.code,
         (select count(*)::int from public.group_members m where m.group_id = g.id),
         (select count(*)::int
            from public.group_members m
            join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not b.stopped
           where m.group_id = g.id)
    from public.groups g
    join public.group_members me on me.group_id = g.id and me.user_id = v_uid
   order by me.joined_at;
end;
$$;

-- set_display_name(p_display_name) -> void; updates all caller memberships
create or replace function public.set_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.olnu_uid();
  v_display text := public.olnu_clean_display_name(p_display_name);
begin
  update public.group_members set display_name = v_display where user_id = v_uid;
end;
$$;

-- save_push_subscription(p_endpoint, p_p256dh, p_auth) -> void; upsert on endpoint
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

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh  = excluded.p256dh,
        auth    = excluded.auth;
end;
$$;

-- delete_push_subscription(p_endpoint) -> void; only caller's own
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------

revoke all on function public.post_beer(float8, float8, bool)                 from public;
revoke all on function public.stop_beer()                                     from public;
revoke all on function public.live_beers()                                    from public;
revoke all on function public.create_group(text, text)                        from public;
revoke all on function public.join_group(text, text)                          from public;
revoke all on function public.leave_group(uuid)                               from public;
revoke all on function public.my_groups()                                     from public;
revoke all on function public.set_display_name(text)                          from public;
revoke all on function public.save_push_subscription(text, text, text)        from public;
revoke all on function public.delete_push_subscription(text)                  from public;

do $$
declare
  f text;
  fns text[] := array[
    'public.post_beer(float8, float8, bool)',
    'public.stop_beer()',
    'public.live_beers()',
    'public.create_group(text, text)',
    'public.join_group(text, text)',
    'public.leave_group(uuid)',
    'public.my_groups()',
    'public.set_display_name(text)',
    'public.save_push_subscription(text, text, text)',
    'public.delete_push_subscription(text)'
  ];
begin
  foreach f in array fns loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Optional: hourly cleanup of expired beers with pg_cron.
-- Not required: live_beers already filters on expires_at and post_beer deletes
-- the caller's expired row. This only keeps the table small and removes old
-- locations from the database. To use it, enable the pg_cron extension
-- (Dashboard → Database → Extensions → pg_cron), then run:
--
-- select cron.schedule(
--   'olnu-delete-expired-beers',
--   '7 * * * *',
--   $$delete from public.beers where expires_at <= now()$$
-- );
-- ---------------------------------------------------------------------------

-- ===== supabase/migrations/0002_skal.sql =====
-- Öl Nu v3 — Skål! (cheers).
-- Binding spec: CONTRACT.md, section "v3 CHANGES → Skål! (cheers) — backend".
-- Run after 0001_olnu.sql. Safe to run again.
--
-- Skåls reset with the night: post_beer (0001) deletes the caller's expired row
-- before it inserts a new one, and skals.beer_id cascades on that delete.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.skals (
  beer_id     bigint not null references public.beers(id) on delete cascade,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  primary key (beer_id, user_id)
);

-- RLS: on, no policies. Also drop the default Supabase table grants.
alter table public.skals enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.skals from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.skals from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- skal(p_beer_id) -> json {skal_count, already}
-- Beer must be live (not expired, not stopped) else beer_not_found.
-- Own beer -> own_beer. One skål per caller per beer.
create or replace function public.skal(p_beer_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.olnu_uid();
  v_owner   uuid;
  v_count   int;
  v_already boolean := false;
  v_rows    int;
begin
  select b.user_id into v_owner
    from public.beers b
   where b.id = p_beer_id
     and b.expires_at > now()
     and not b.stopped;
  if not found then
    raise exception 'beer_not_found';
  end if;

  if v_owner = v_uid then
    raise exception 'own_beer';
  end if;

  insert into public.skals (beer_id, user_id)
  values (p_beer_id, v_uid)
  on conflict (beer_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  v_already := (v_rows = 0);

  select count(*)::int into v_count from public.skals s where s.beer_id = p_beer_id;

  return json_build_object('skal_count', v_count, 'already', v_already);
end;
$$;

-- live_beers() -> setof (id, lat, lng, beer_count, precise, created_at, is_mine,
--                        friend_name, skal_count, i_skaled)
-- Same as 0001 plus the two skål columns at the end. Excludes stopped and expired rows.
drop function if exists public.live_beers();
create or replace function public.live_beers()
returns table (
  id          bigint,
  lat         float8,
  lng         float8,
  beer_count  int,
  precise     bool,
  created_at  timestamptz,
  is_mine     bool,
  friend_name text,
  skal_count  int,
  i_skaled    bool
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select b.id, b.lat, b.lng, b.beer_count, b.precise, b.created_at,
         (b.user_id = v_uid) as is_mine,
         case when b.user_id = v_uid then null
              else (select min(am.display_name)
                      from public.group_members am
                      join public.group_members cm
                        on cm.group_id = am.group_id and cm.user_id = v_uid
                     where am.user_id = b.user_id)
         end as friend_name,
         (select count(*)::int from public.skals s where s.beer_id = b.id) as skal_count,
         exists (select 1 from public.skals s where s.beer_id = b.id and s.user_id = v_uid) as i_skaled
    from public.beers b
   where b.expires_at > now()
     and not b.stopped
   order by b.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------

revoke all on function public.skal(bigint)  from public;
revoke all on function public.live_beers()  from public;

do $$
declare
  f text;
  fns text[] := array[
    'public.skal(bigint)',
    'public.live_beers()'
  ];
begin
  foreach f in array fns loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

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

-- ===== supabase/migrations/0007_social.sql =====
-- v7 SOCIAL: weekly beers, Kung av baren, group league, group chat, reactions, ghost pins,
-- levels and titles. Additive only (COMPATIBILITY RULES): new tables, new RPCs, one new trigger.
-- No old RPC, parameter or returned field changes, so old app versions keep working.
-- Safe to re-run. This file has no remove-type statements on purpose (create-or-replace,
-- "if not exists" and "on conflict" only). Old beer_events rows are now cleaned up by the
-- notify-group edge function (10 days), not by the trigger.
-- Needs Postgres 14+ (create or replace trigger).

-- ---------------------------------------------------------------------------
-- Helpers (internal, not callable by clients)
-- ---------------------------------------------------------------------------

-- Monday (Europe/Stockholm) of the week that contains p.
create or replace function public.olnu_week_start(p timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select date_trunc('week', p at time zone 'Europe/Stockholm')::date;
$$;

-- Great-circle distance in metres (haversine).
create or replace function public.olnu_dist_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8
language sql
immutable
set search_path = public
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2) +
           cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

-- Title ladder by lifetime beers. Same list as TITLES in notify-group and in CONTRACT.md.
create or replace function public.olnu_titles()
returns table (at int, title text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    (0, 'Rekryt'), (5, 'Menig Mjöd'), (15, 'Korpral Kork'), (30, 'Sergeant Skum'),
    (50, 'Löjtnant Lager'), (75, 'Kapten Kapsyl'), (100, 'Major Malt'), (150, 'Öl-veteranen'),
    (200, 'Överste Öl'), (300, 'General Gambrinus'), (500, 'Fältmarskalk Fatöl'),
    (750, 'Bryggerilegenden'), (1000, 'Ölguden')
  ) as t(at, title);
$$;

-- Lifetime beers for one user (sum of week_beers). Defined after the table below.

revoke all on function public.olnu_week_start(timestamptz)                  from public;
revoke all on function public.olnu_dist_m(float8, float8, float8, float8)   from public;
revoke all on function public.olnu_titles()                                 from public;

-- ---------------------------------------------------------------------------
-- Tables (RLS on, no policies; only SECURITY DEFINER functions and the service role use them)
-- ---------------------------------------------------------------------------

-- 1. Beers per user per week (week = Monday, Europe/Stockholm).
create table if not exists public.week_beers (
  user_id uuid not null,
  week    date not null,
  n       int  not null default 0,
  primary key (user_id, week)
);
create index if not exists week_beers_week_idx on public.week_beers (week);

-- 2. Kung av baren: check-ins per user, bar and week.
create table if not exists public.bar_taps (
  user_id  uuid not null,
  bar_id   text not null,
  week     date not null,
  n        int  not null default 0,
  bar_name text,
  lat      float8,
  lng      float8,
  last_at  timestamptz not null default now(),
  primary key (user_id, bar_id, week)
);
alter table public.bar_taps add column if not exists last_at timestamptz not null default now();
create index if not exists bar_taps_bar_week_idx on public.bar_taps (bar_id, week);

-- 4. Group chat. Messages live until the next 05:00 (same as beer pins).
create table if not exists public.group_msgs (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  body       text not null check (char_length(body) between 1 and 140),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists group_msgs_group_idx on public.group_msgs (group_id, id);
create index if not exists group_msgs_user_idx  on public.group_msgs (user_id, created_at);

-- 5. Reactions on live beers. No foreign key: rows of old beers stay but are never shown,
--    because every read joins live beers (beer ids are never reused). Toggle = active flag.
create table if not exists public.reactions (
  beer_id    bigint not null,
  user_id    uuid not null,
  emoji      text not null check (emoji in ('🔥', '😂', '💀', '💪')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (beer_id, user_id, emoji)
);
create index if not exists reactions_beer_idx on public.reactions (beer_id);

-- push_sent (0006) gets a send time, for the sliding rate limits in notify-group.
alter table public.push_sent add column if not exists sent_at timestamptz not null default now();

alter table public.week_beers enable row level security;
alter table public.bar_taps   enable row level security;
alter table public.group_msgs enable row level security;
alter table public.reactions  enable row level security;

revoke all on table public.week_beers, public.bar_taps, public.group_msgs, public.reactions from public;
revoke all on sequence public.group_msgs_id_seq from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.week_beers, public.bar_taps, public.group_msgs, public.reactions from anon';
    execute 'revoke all on sequence public.group_msgs_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.week_beers, public.bar_taps, public.group_msgs, public.reactions from authenticated';
    execute 'revoke all on sequence public.group_msgs_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.week_beers, public.bar_taps, public.group_msgs, public.reactions, public.beer_events, public.push_sent to service_role';
  end if;
end $$;

create or replace function public.olnu_lifetime(p_uid uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(w.n), 0)::int from public.week_beers w where w.user_id = p_uid;
$$;
revoke all on function public.olnu_lifetime(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_week_start(timestamptz), public.olnu_dist_m(float8, float8, float8, float8), public.olnu_titles(), public.olnu_lifetime(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_week_start(timestamptz), public.olnu_dist_m(float8, float8, float8, float8), public.olnu_titles(), public.olnu_lifetime(uuid) from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- 1. week_beers: add each increase of beers.beer_count to this week's row.
create or replace function public.olnu_week_beers_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_inc int;
begin
  if tg_op = 'INSERT' then
    v_inc := coalesce(new.beer_count, 0);
  else
    v_inc := coalesce(new.beer_count, 0) - coalesce(old.beer_count, 0);
  end if;
  if v_inc > 0 then
    insert into public.week_beers (user_id, week, n)
    values (new.user_id, public.olnu_week_start(now()), v_inc)
    on conflict (user_id, week) do update set n = public.week_beers.n + excluded.n;
  end if;
  return new;
end; $$;
revoke all on function public.olnu_week_beers_tg() from public;

create or replace trigger olnu_week_beers
  after insert or update of beer_count on public.beers
  for each row execute function public.olnu_week_beers_tg();

-- 6. Heat events (0005): same behaviour, but without the old-row cleanup.
--    The notify-group edge function now cleans beer_events older than 10 days (5% of calls),
--    so ghost_points can show the last 8 days.
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
  return new;
end; $$;
revoke all on function public.olnu_log_beer_event() from public;
create index if not exists beer_events_created_idx on public.beer_events (created_at);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_week_beers_tg(), public.olnu_log_beer_event() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_week_beers_tg(), public.olnu_log_beer_event() from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- 2. record_bar(p_bar_id, p_bar_name, p_lat, p_lng) -> void
-- Counts one check-in at a bar for this week. Silently does nothing unless: the caller has a live,
-- precise beer accepted in the last 3 minutes within 150 m of (p_lat, p_lng), and the caller's last
-- check-in at this bar is at least 9 minutes old.
create or replace function public.record_bar(p_bar_id text, p_bar_name text, p_lat float8, p_lng float8)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := btrim(coalesce(p_bar_id, ''));
  v_name text := left(btrim(regexp_replace(coalesce(p_bar_name, ''), '[[:cntrl:]]', ' ', 'g')), 80);
  v_ok   boolean;
begin
  if char_length(v_id) < 1 or char_length(v_id) > 64
     or p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < 55.0 or p_lat > 69.1 or p_lng < 10.9 or p_lng > 24.2 then
    return;
  end if;

  select exists (
    select 1 from public.beers b
     where b.user_id = v_uid
       and b.expires_at > now()
       and not b.stopped
       and b.precise
       and b.beer_count > 0
       and coalesce(b.beer_at, b.updated_at) > now() - interval '3 minutes'
       and public.olnu_dist_m(b.lat, b.lng, p_lat, p_lng) <= 150
  ) into v_ok;
  if not v_ok then
    return;
  end if;

  insert into public.bar_taps (user_id, bar_id, week, n, bar_name, lat, lng, last_at)
  values (v_uid, v_id, public.olnu_week_start(now()), 1, nullif(v_name, ''),
          round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8, now())
  on conflict (user_id, bar_id, week) do update
     set n = public.bar_taps.n + 1,
         last_at = now(),
         bar_name = coalesce(excluded.bar_name, public.bar_taps.bar_name),
         lat = excluded.lat,
         lng = excluded.lng
   where public.bar_taps.last_at <= now() - interval '9 minutes';
end;
$$;

-- bar_kings(p_bar_ids) -> setof (bar_id, king_name, king_n, is_me)
-- One row per bar (of the given ids, max 500) that has check-ins this week. King = most check-ins
-- this week; tie -> the one who reached that number first. king_name only when the king shares a
-- group with the caller (or is the caller); else null ("En hemlig agent").
create or replace function public.bar_kings(p_bar_ids text[])
returns table (bar_id text, king_name text, king_n int, is_me bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with ids as (
    select distinct x as id from unnest((coalesce(p_bar_ids, array[]::text[]))[1:500]) as u(x)
  ),
  ranked as (
    select t.bar_id as b_id, t.user_id as u_id, t.n as cnt,
           row_number() over (partition by t.bar_id order by t.n desc, t.last_at asc, t.user_id) as rn
      from public.bar_taps t
      join ids on ids.id = t.bar_id
     where t.week = public.olnu_week_start(now())
       and t.n > 0
  )
  select r.b_id,
         (select min(am.display_name)
            from public.group_members am
            join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
           where am.user_id = r.u_id),
         r.cnt,
         (r.u_id = v_uid)
    from ranked r
   where r.rn = 1
   order by r.b_id;
end;
$$;

-- 3. group_league() -> setof (group_id, name, total, members, rank, is_mine)
-- This week's beers per group (sum of members' week_beers), groups with >= 2 members.
-- Returns the top 10 plus the caller's own groups. name is null for groups the caller is not in.
create or replace function public.group_league()
returns table (group_id uuid, name text, total int, members int, rank int, is_mine bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with g as (
    select gm.group_id as gid,
           count(*)::int as cnt,
           coalesce(sum(wb.n), 0)::int as tot,
           bool_or(gm.user_id = v_uid) as mine
      from public.group_members gm
      left join public.week_beers wb
        on wb.user_id = gm.user_id and wb.week = public.olnu_week_start(now())
     group by gm.group_id
    having count(*) >= 2
  ),
  r as (
    select g.*, grp.name as gname, grp.created_at as gcreated,
           (row_number() over (order by g.tot desc, grp.created_at asc, g.gid))::int as rnk
      from g join public.groups grp on grp.id = g.gid
  )
  select r.gid, case when r.mine then r.gname else null end, r.tot, r.cnt, r.rnk, r.mine
    from r
   where r.rnk <= 10 or r.mine
   order by r.rnk;
end;
$$;

-- 4. post_group_msg(p_group_id, p_body) -> json {id, created_at}
-- Errors: not_member, invalid_msg (empty or > 140 chars after trim), slow_down (1 per 20 s per user).
create or replace function public.post_group_msg(p_group_id uuid, p_body text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x08\x0B-\x1F\x7F]', '', 'g'));
  v_id   bigint;
  v_at   timestamptz;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 140 then
    raise exception 'invalid_msg';
  end if;
  -- Serialize per user so two fast calls cannot both pass the rate limit.
  perform pg_advisory_xact_lock(hashtextextended('olnu_msg:' || v_uid::text, 0));
  if exists (select 1 from public.group_msgs m
              where m.user_id = v_uid and m.created_at > now() - interval '20 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, public.olnu_next_expiry())
  returning group_msgs.id, group_msgs.created_at into v_id, v_at;
  return json_build_object('id', v_id, 'created_at', v_at);
end;
$$;

-- group_msgs(p_group_id, p_after_id default 0) -> setof (id, name, body, created_at, is_me)
-- Live messages (not expired), oldest first, max 100. p_after_id = 0: the newest 100.
-- p_after_id > 0: the next 100 with id > p_after_id (for polling). Error: not_member.
-- name = sender's display_name in this group (null if the sender left the group).
create or replace function public.group_msgs(p_group_id uuid, p_after_id bigint default 0)
returns table (id bigint, name text, body text, created_at timestamptz, is_me bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_after bigint := coalesce(p_after_id, 0);
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select s.mid, s.mname, s.mbody, s.mat, s.mme
    from (
      select gm.id as mid,
             (select mm.display_name from public.group_members mm
               where mm.group_id = gm.group_id and mm.user_id = gm.user_id) as mname,
             gm.body as mbody, gm.created_at as mat, (gm.user_id = v_uid) as mme
        from public.group_msgs gm
       where gm.group_id = p_group_id
         and gm.expires_at > now()
         and gm.id > v_after
       order by case when v_after = 0 then -gm.id else gm.id end
       limit 100
    ) s
   order by s.mid;
end;
$$;

-- 5. react(p_beer_id, p_emoji) -> json {counts: {emoji: n}, mine: [emoji, ...]}
-- Toggles the caller's reaction. Errors: invalid_emoji, beer_not_found, own_beer.
-- counts only has emojis with n > 0.
create or replace function public.react(p_beer_id bigint, p_emoji text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_owner  uuid;
  v_counts json;
  v_mine   json;
begin
  if p_emoji is null or p_emoji not in ('🔥', '😂', '💀', '💪') then
    raise exception 'invalid_emoji';
  end if;
  select b.user_id into v_owner
    from public.beers b
   where b.id = p_beer_id and b.expires_at > now() and not b.stopped;
  if not found then
    raise exception 'beer_not_found';
  end if;
  if v_owner = v_uid then
    raise exception 'own_beer';
  end if;

  insert into public.reactions (beer_id, user_id, emoji)
  values (p_beer_id, v_uid, p_emoji)
  on conflict (beer_id, user_id, emoji) do update
     set active = not public.reactions.active, updated_at = now();

  select coalesce(json_object_agg(c.emoji, c.cnt), '{}'::json) into v_counts
    from (select r.emoji, count(*)::int as cnt
            from public.reactions r
           where r.beer_id = p_beer_id and r.active
           group by r.emoji) c;
  select coalesce(json_agg(r.emoji order by r.emoji), '[]'::json) into v_mine
    from public.reactions r
   where r.beer_id = p_beer_id and r.user_id = v_uid and r.active;

  return json_build_object('counts', v_counts, 'mine', v_mine);
end;
$$;

-- beer_reactions() -> setof (beer_id, emoji, n, mine) for all live beers, active reactions only.
create or replace function public.beer_reactions()
returns table (beer_id bigint, emoji text, n int, mine bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select r.beer_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid)
    from public.reactions r
    join public.beers b on b.id = r.beer_id and b.expires_at > now() and not b.stopped
   where r.active
   group by r.beer_id, r.emoji
   order by r.beer_id, r.emoji;
end;
$$;

-- 6. ghost_points() -> setof (lat, lng, w): anonymous beers from 1 to 8 days ago.
-- Precise events snap to ~55 m cells; approximate events keep their ~550 m grid. w = number of beers.
create or replace function public.ghost_points()
returns table (lat float8, lng float8, w float8)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.olnu_uid();
  return query
  select c.clat, c.clng, count(*)::float8 as cw
    from (
      select case when e.precise then (round(e.lat::numeric / 0.0005) * 0.0005)::float8 else e.lat end as clat,
             case when e.precise then (round(e.lng::numeric / 0.001) * 0.001)::float8 else e.lng end as clng
        from public.beer_events e
       where e.kind = 'beer'
         and e.created_at >= now() - interval '8 days'
         and e.created_at <  now() - interval '1 day'
    ) c
   group by c.clat, c.clng
   order by cw desc
   limit 5000;
end;
$$;

-- 9. my_stats() -> json {total, week, title, next_title, next_at}
-- total = lifetime beers (sum of week_beers, history starts with v7), week = this week.
create or replace function public.my_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_total int := public.olnu_lifetime(v_uid);
  v_week  int;
  v_title text;
  v_next  text;
  v_at    int;
begin
  select coalesce(sum(w.n), 0)::int into v_week
    from public.week_beers w where w.user_id = v_uid and w.week = public.olnu_week_start(now());
  select t.title into v_title from public.olnu_titles() t where t.at <= v_total order by t.at desc limit 1;
  select t.title, t.at into v_next, v_at from public.olnu_titles() t where t.at > v_total order by t.at limit 1;
  return json_build_object('total', v_total, 'week', v_week, 'title', v_title,
                           'next_title', v_next, 'next_at', v_at);
end;
$$;

-- friend_totals() -> setof (beer_id, total): lifetime beers for LIVE beers owned by the caller or
-- by users who share a group with the caller. Strangers are never returned.
create or replace function public.friend_totals()
returns table (beer_id bigint, total int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select b.id, public.olnu_lifetime(b.user_id)
    from public.beers b
   where b.expires_at > now()
     and not b.stopped
     and (b.user_id = v_uid
          or exists (select 1
                       from public.group_members am
                       join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
                      where am.user_id = b.user_id))
   order by b.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  fns text[] := array[
    'public.record_bar(text, text, float8, float8)',
    'public.bar_kings(text[])',
    'public.group_league()',
    'public.post_group_msg(uuid, text)',
    'public.group_msgs(uuid, bigint)',
    'public.react(bigint, text)',
    'public.beer_reactions()',
    'public.ghost_points()',
    'public.my_stats()',
    'public.friend_totals()'
  ];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- ===== supabase/migrations/0008_other_drinks.sql =====
-- Öl Nu v8: "annan drink" (sidospår) + group status. Additive. Safe to run again.
-- Other drinks never count as beers, never change streaks, titles or milestones.
alter table public.beers add column if not exists other_count int not null default 0;
alter table public.beers add column if not exists other_kind text;
alter table public.beers add column if not exists other_at timestamptz;

-- post_other(p_kind, p_lat, p_lng, p_precise) -> json {accepted, wait_seconds, id, beer_count, other_count, other_kind, expires_at}
-- p_kind in: rom, vin, cider, drink, shot, whisky, annat. 10 min cooldown between other drinks.
-- Moves the pin like a beer. Errors: outside_sweden, invalid_kind, not_authenticated.
create or replace function public.post_other(p_kind text, p_lat float8, p_lng float8, p_precise bool)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_precise boolean := coalesce(p_precise, false);
  v_lat float8; v_lng float8;
  v_row public.beers%rowtype;
  v_accepted boolean := true;
  v_wait int := 0;
  v_cooldown constant interval := interval '10 minutes';
begin
  if v_kind not in ('rom', 'vin', 'cider', 'drink', 'shot', 'whisky', 'annat') then
    raise exception 'invalid_kind';
  end if;
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
    if v_row.other_at is not null and v_row.other_at > now() - v_cooldown then
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (v_row.other_at + v_cooldown - now())))::int);
    else
      update public.beers set lat = v_lat, lng = v_lng, precise = v_precise,
             other_count = other_count + 1, other_kind = v_kind, other_at = now(),
             updated_at = now(), stopped = false
       where id = v_row.id returning * into v_row;
    end if;
  else
    insert into public.beers (user_id, lat, lng, precise, expires_at, beer_count, other_count, other_kind, other_at)
    values (v_uid, v_lat, v_lng, v_precise, public.olnu_next_expiry(), 0, 1, v_kind, now())
    on conflict (user_id) do nothing returning * into v_row;
    if v_row.id is null then
      select * into v_row from public.beers where user_id = v_uid;
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (coalesce(v_row.other_at, now()) + v_cooldown - now())))::int);
    end if;
  end if;
  return json_build_object('accepted', v_accepted, 'wait_seconds', v_wait, 'id', v_row.id,
    'beer_count', v_row.beer_count, 'other_count', v_row.other_count, 'other_kind', v_row.other_kind,
    'expires_at', v_row.expires_at);
end; $$;

-- live_others() -> setof (beer_id, other_count, other_kind) for live, not stopped rows with other drinks.
create or replace function public.live_others()
returns table (beer_id bigint, other_count int, other_kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.olnu_uid();
  return query
  select b.id, b.other_count, b.other_kind from public.beers b
   where b.expires_at > now() and not b.stopped and b.other_count > 0
   order by b.id;
end; $$;

-- group_status(p_group_id) -> setof (name, beers, others, other_kind, live, total, is_me)
-- Every member of the group (also those not out). beers/others = tonight (0 if no row tonight).
-- live = has a visible pin now. total = lifetime beers. Error: not_member.
create or replace function public.group_status(p_group_id uuid)
returns table (name text, beers int, others int, other_kind text, live bool, total int, is_me bool)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select gm.display_name,
         coalesce(case when b.expires_at > now() then b.beer_count end, 0)::int,
         coalesce(case when b.expires_at > now() then b.other_count end, 0)::int,
         case when b.expires_at > now() then b.other_kind end,
         coalesce(b.expires_at > now() and not b.stopped, false),
         public.olnu_lifetime(gm.user_id),
         (gm.user_id = v_uid)
    from public.group_members gm
    left join public.beers b on b.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by 2 desc, 3 desc, 1;
end; $$;

revoke all on function public.post_other(text, float8, float8, bool), public.live_others(), public.group_status(uuid) from public, anon;
grant execute on function public.post_other(text, float8, float8, bool), public.live_others(), public.group_status(uuid) to authenticated;

-- ===== supabase/migrations/0009_rally.sql =====
-- Öl Nu v9: INKALLELSE (rally / call-out). Additive. Safe to run again.
-- A group member calls friends to a place ("🪖 Behöver män till skyttegraven! Ses på Pitchers").
-- Members answer yes / no / maybe. Everyone in the group sees "7 på väg".
-- No old RPC, parameter or returned field changes. This file has no remove-type statements and no
-- foreign keys on purpose (create-or-replace, "if not exists" and "on conflict" only).
-- Rallies live until the next 05:00 Europe/Stockholm (same as pins), or until the creator closes them.

-- ---------------------------------------------------------------------------
-- Tables (RLS on, no policies; only SECURITY DEFINER functions and the service role use them)
-- ---------------------------------------------------------------------------

create table if not exists public.rallies (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  body       text not null check (char_length(body) between 1 and 100),
  place      text check (place is null or char_length(place) <= 60),
  lat        float8,
  lng        float8,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default public.olnu_next_expiry(),
  closed     boolean not null default false
);
create index if not exists rallies_group_idx on public.rallies (group_id, id);
create index if not exists rallies_user_idx  on public.rallies (user_id, created_at);

create table if not exists public.rally_answers (
  rally_id   bigint not null,
  user_id    uuid not null,
  answer     text not null check (answer in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  notified   boolean not null default false,
  primary key (rally_id, user_id)
);

alter table public.rallies       enable row level security;
alter table public.rally_answers enable row level security;

revoke all on table public.rallies, public.rally_answers from public;
revoke all on sequence public.rallies_id_seq from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.rallies, public.rally_answers from anon';
    execute 'revoke all on sequence public.rallies_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.rallies, public.rally_answers from authenticated';
    execute 'revoke all on sequence public.rallies_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.rallies, public.rally_answers to service_role';
    execute 'grant all on sequence public.rallies_id_seq to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helper (internal, not callable by clients)
-- ---------------------------------------------------------------------------

-- Live, open rallies visible to p_uid (only groups p_uid is a member of), newest first, max 10.
-- p_group_id null = all of p_uid's groups. Counts and yes_names only include current members.
-- name = creator's display_name in that group (null if the creator left).
create or replace function public.olnu_rally_rows(p_uid uuid, p_group_id uuid)
returns table (id bigint, name text, body text, place text, lat float8, lng float8,
               created_at timestamptz, yes int, no int, maybe int, my_answer text,
               yes_names text[], is_mine bool, group_id uuid, group_name text)
language sql
stable
set search_path = public
as $$
  select r.id,
         cm.display_name,
         r.body, r.place, r.lat, r.lng, r.created_at,
         coalesce(c.y, 0), coalesce(c.n, 0), coalesce(c.m, 0),
         (select a.answer from public.rally_answers a where a.rally_id = r.id and a.user_id = p_uid),
         coalesce(c.names, array[]::text[]),
         (r.user_id = p_uid),
         r.group_id,
         g.name
    from public.rallies r
    join public.group_members me on me.group_id = r.group_id and me.user_id = p_uid
    left join public.groups g on g.id = r.group_id
    left join public.group_members cm on cm.group_id = r.group_id and cm.user_id = r.user_id
    left join lateral (
      select count(*) filter (where a.answer = 'yes')::int   as y,
             count(*) filter (where a.answer = 'no')::int    as n,
             count(*) filter (where a.answer = 'maybe')::int as m,
             array_agg(gm.display_name order by (a.user_id = r.user_id) desc, a.updated_at, gm.display_name)
               filter (where a.answer = 'yes') as names
        from public.rally_answers a
        join public.group_members gm on gm.group_id = r.group_id and gm.user_id = a.user_id
       where a.rally_id = r.id
    ) c on true
   where r.expires_at > now()
     and not r.closed
     and (p_group_id is null or r.group_id = p_group_id)
   order by r.created_at desc, r.id desc
   limit 10;
$$;

revoke all on function public.olnu_rally_rows(uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_rally_rows(uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_rally_rows(uuid, uuid) from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- create_rally(p_group_id, p_body, p_place default null, p_lat default null, p_lng default null) -> json {id}
-- Errors: not_member, invalid_msg (body > 100 or place > 60 after trim), slow_down (1 per 3 min per user).
-- Empty body -> 'Behöver förstärkning!'. lat/lng are kept only when both are inside Sweden (else ignored).
-- The creator is answered 'yes' (notified, so no "på väg" push to self). Older open rallies by the same
-- user in the same group are closed.
create or replace function public.create_rally(p_group_id uuid, p_body text, p_place text default null,
                                               p_lat float8 default null, p_lng float8 default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_body  text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_place text := btrim(regexp_replace(coalesce(p_place, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_lat   float8;
  v_lng   float8;
  v_id    bigint;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_body = '' then
    v_body := 'Behöver förstärkning!';
  end if;
  if char_length(v_body) > 100 or char_length(v_place) > 60 then
    raise exception 'invalid_msg';
  end if;
  if p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between 55.0 and 69.1 and p_lng between 10.9 and 24.2 then
    v_lat := round(p_lat::numeric, 5)::float8;
    v_lng := round(p_lng::numeric, 5)::float8;
  end if;

  -- Serialize per user so two fast calls cannot both pass the rate limit.
  perform pg_advisory_xact_lock(hashtextextended('olnu_rally:' || v_uid::text, 0));
  if exists (select 1 from public.rallies r
              where r.user_id = v_uid and r.created_at > now() - interval '3 minutes') then
    raise exception 'slow_down';
  end if;

  update public.rallies set closed = true
   where user_id = v_uid and group_id = p_group_id and not closed;

  insert into public.rallies (group_id, user_id, body, place, lat, lng, expires_at)
  values (p_group_id, v_uid, v_body, nullif(v_place, ''), v_lat, v_lng, public.olnu_next_expiry())
  returning rallies.id into v_id;

  insert into public.rally_answers (rally_id, user_id, answer, notified)
  values (v_id, v_uid, 'yes', true)
  on conflict (rally_id, user_id) do update set answer = 'yes', updated_at = now(), notified = true;

  return json_build_object('id', v_id);
end;
$$;

-- answer_rally(p_rally_id, p_answer) -> json {yes, no, maybe, mine}
-- Errors: invalid_answer, rally_not_found (missing, expired, closed), not_member.
-- Upsert. A changed answer keeps its notified flag (so yes -> no -> yes does not push twice).
create or replace function public.answer_rally(p_rally_id bigint, p_answer text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_answer text := lower(btrim(coalesce(p_answer, '')));
  v_gid    uuid;
  v_y int; v_n int; v_m int;
begin
  if v_answer not in ('yes', 'no', 'maybe') then
    raise exception 'invalid_answer';
  end if;
  select r.group_id into v_gid
    from public.rallies r
   where r.id = p_rally_id and r.expires_at > now() and not r.closed;
  if not found then
    raise exception 'rally_not_found';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;

  insert into public.rally_answers (rally_id, user_id, answer)
  values (p_rally_id, v_uid, v_answer)
  on conflict (rally_id, user_id) do update set answer = excluded.answer, updated_at = now();

  select count(*) filter (where a.answer = 'yes')::int,
         count(*) filter (where a.answer = 'no')::int,
         count(*) filter (where a.answer = 'maybe')::int
    into v_y, v_n, v_m
    from public.rally_answers a
    join public.group_members gm on gm.group_id = v_gid and gm.user_id = a.user_id
   where a.rally_id = p_rally_id;

  return json_build_object('yes', v_y, 'no', v_n, 'maybe', v_m, 'mine', v_answer);
end;
$$;

-- close_rally(p_rally_id) -> void. Creator only, else rally_not_found. Closing twice is fine.
create or replace function public.close_rally(p_rally_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  update public.rallies set closed = true where id = p_rally_id and user_id = v_uid;
  if not found then
    raise exception 'rally_not_found';
  end if;
end;
$$;

-- group_rallies(p_group_id) -> setof (id, name, body, place, lat, lng, created_at, yes, no, maybe,
--   my_answer, yes_names, is_mine). Live and open, newest first, max 10. Error: not_member.
create or replace function public.group_rallies(p_group_id uuid)
returns table (id bigint, name text, body text, place text, lat float8, lng float8,
               created_at timestamptz, yes int, no int, maybe int, my_answer text,
               yes_names text[], is_mine bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select r.id, r.name, r.body, r.place, r.lat, r.lng, r.created_at, r.yes, r.no, r.maybe,
         r.my_answer, r.yes_names, r.is_mine
    from public.olnu_rally_rows(v_uid, p_group_id) r;
end;
$$;

-- my_rallies() -> same columns as group_rallies + group_id, group_name. All the caller's groups,
-- live and open, newest first, max 10 (for the HUD banner).
create or replace function public.my_rallies()
returns table (id bigint, name text, body text, place text, lat float8, lng float8,
               created_at timestamptz, yes int, no int, maybe int, my_answer text,
               yes_names text[], is_mine bool, group_id uuid, group_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select r.id, r.name, r.body, r.place, r.lat, r.lng, r.created_at, r.yes, r.no, r.maybe,
         r.my_answer, r.yes_names, r.is_mine, r.group_id, r.group_name
    from public.olnu_rally_rows(v_uid, null) r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  fns text[] := array[
    'public.create_rally(uuid, text, text, float8, float8)',
    'public.answer_rally(bigint, text)',
    'public.close_rally(bigint)',
    'public.group_rallies(uuid)',
    'public.my_rallies()'
  ];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- ===== supabase/migrations/0010_heat_precision.sql =====
-- Öl Nu: heat map closer to where each beer was drunk. Precise beers now snap to ~10 m cells
-- (was ~55 m). "Bara område" beers keep their ~550 m grid on purpose (privacy). Shots no longer count.
-- Same name, same return shape (COMPATIBILITY RULES). Safe to run again.
create or replace function public.heat_points()
returns table (lat float8, lng float8, w float8)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.olnu_uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select c.lat, c.lng, sum(c.w)::float8 as w
    from (
      select
        case when e.precise then (round(e.lat::numeric / 0.0001) * 0.0001)::float8 else e.lat end as lat,
        case when e.precise then (round(e.lng::numeric / 0.0002) * 0.0002)::float8 else e.lng end as lng,
        case when e.n >= 10 then 3
             when e.n >= 5 then 2
             else 1 end::float8 as w
      from public.beer_events e
      where e.expires_at > now() and e.kind = 'beer'
    ) c
    group by c.lat, c.lng
    order by w desc
    limit 5000;
end; $$;
revoke all on function public.heat_points() from public, anon;
grant execute on function public.heat_points() to authenticated;

-- ===== supabase/migrations/0011_checkin.sql =====
-- Öl Nu v10: CHECKA IN. Additive. Safe to run again.
-- Tap a bar on the map -> "Checka in". Group-mates see "Anton har anlänt till La Parma".
-- One active check-in per user per night (a new check-in replaces the old one: upsert on user_id).
-- Rows expire at the next 05:00 Europe/Stockholm (same as pins). Old rows are never read again:
-- every query filters on expires_at > now(). No old RPC, parameter or returned field changes.
-- This file has no remove-type statements on purpose (create-or-replace, "if not exists", "on conflict").

-- ---------------------------------------------------------------------------
-- Table (RLS on, no policies; only SECURITY DEFINER functions and the service role use it)
-- ---------------------------------------------------------------------------

create table if not exists public.checkins (
  user_id    uuid primary key,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  bar_name   text not null check (char_length(bar_name) between 1 and 60),
  lat        float8 not null,
  lng        float8 not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default public.olnu_next_expiry()
);
create index if not exists checkins_expires_idx on public.checkins (expires_at);

alter table public.checkins enable row level security;

revoke all on table public.checkins from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.checkins from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.checkins from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.checkins to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- check_in(p_bar_id, p_bar_name, p_lat, p_lng) -> jsonb {ok, bar_name, wait_seconds}
-- ok=false + wait_seconds > 0 when the caller checked in less than 2 minutes ago (nothing changes;
-- bar_name = the current check-in). Errors: not_authenticated, outside_sweden, invalid_bar.
-- Bar name: control chars -> space, trimmed, 1-60 chars. Bar id: trimmed, 1-80 chars.
create or replace function public.check_in(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := btrim(regexp_replace(coalesce(p_bar_id, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_bar_name, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
  v_row  public.checkins%rowtype;
  v_cool constant interval := interval '2 minutes';
begin
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < 55.0 or p_lat > 69.1 or p_lng < 10.9 or p_lng > 24.2 then
    raise exception 'outside_sweden';
  end if;
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_bar';
  end if;

  -- Serialize per user so two fast calls cannot both pass the rate limit.
  perform pg_advisory_xact_lock(hashtextextended('olnu_checkin:' || v_uid::text, 0));
  select * into v_row from public.checkins c where c.user_id = v_uid;
  if found and v_row.created_at > now() - v_cool then
    return jsonb_build_object('ok', false,
      'bar_name', case when v_row.expires_at > now() then v_row.bar_name else null end,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_row.created_at + v_cool - now())))::int));
  end if;

  insert into public.checkins (user_id, bar_id, bar_name, lat, lng, created_at, expires_at)
  values (v_uid, v_id, v_name, round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8,
          now(), public.olnu_next_expiry())
  on conflict (user_id) do update
     set bar_id = excluded.bar_id, bar_name = excluded.bar_name, lat = excluded.lat, lng = excluded.lng,
         created_at = excluded.created_at, expires_at = excluded.expires_at;

  return jsonb_build_object('ok', true, 'bar_name', v_name, 'wait_seconds', 0);
end;
$$;

-- live_checkins() -> setof (bar_id, bar_name, lat, lng, name, is_mine, is_friend, created_at)
-- Tonight's active check-ins (expires_at > now()), oldest first, max 2000.
-- name: own row -> caller's display_name in any group (null without a group; the app uses its own name);
-- a user who shares a group with the caller -> that user's display_name in a shared group (smallest);
-- strangers -> null (anonymous). Same rule as live_beers.friend_name.
create or replace function public.live_checkins()
returns table (bar_id text, bar_name text, lat float8, lng float8, name text,
               is_mine bool, is_friend bool, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select c.bar_id, c.bar_name, c.lat, c.lng,
         case when c.user_id = v_uid
              then (select min(mm.display_name) from public.group_members mm where mm.user_id = v_uid)
              else f.fname end,
         (c.user_id = v_uid),
         (c.user_id <> v_uid and f.fname is not null),
         c.created_at
    from public.checkins c
    left join lateral (
      select min(am.display_name) as fname
        from public.group_members am
        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
       where am.user_id = c.user_id and c.user_id <> v_uid
    ) f on true
   where c.expires_at > now()
   order by c.created_at
   limit 2000;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  fns text[] := array[
    'public.check_in(text, text, double precision, double precision)',
    'public.live_checkins()'
  ];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- ===== supabase/migrations/0012_medals.sql =====
-- Öl Nu v11: MEDALS & RANKS. Additive. Safe to run again.
-- 1. New rank ladder (36 steps, dense at the start). Same function name and return type as before (olnu_titles),
--    so my_stats / old clients keep working. Same list in notify-group TITLES and docs/js/social.js.
-- 2. Medals stored on the server so group-mates can see them (user_medals).
--    Facts are logged by small triggers (medal_nights, medal_checkins, medal_counts) because the
--    beers / checkins / skals rows only live for one night. award_medals() evaluates the rules from
--    server data and stores the result. claim_medal() lets the client report a few low-stakes,
--    local-only medals (whitelist). No medal rewards drinking fast or many beers in a short time.
-- This file has no remove-type statements on purpose (create-or-replace, "if not exists",
-- "on conflict" only). Every trigger body catches its own errors, so a medal bug can never
-- block a beer, a check-in, a skål or a chat message.
-- Needs 0001-0011 first. Postgres 14+ (create or replace trigger).

-- ---------------------------------------------------------------------------
-- 1. Rank ladder
-- ---------------------------------------------------------------------------
create or replace function public.olnu_titles()
returns table (at int, title text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    (0, 'Rekryt'), (3, 'Mönstrad Mellanöl'), (5, 'Menig Mjöd'), (7, 'Vicekorpral Kapsyl'),
    (10, 'Kapsylkorpral från Grangärde'), (13, 'Skumsergeant'), (17, 'Furir Flaskhals'),
    (22, 'Överfurir Fatkran'), (28, 'Fanjunkare Flasköppnare'), (35, 'Fänrik Fatöl'),
    (43, 'Löjtnant Lager'), (52, 'Premiärlöjtnant Pilsner'), (62, 'Kapten Kaggen'),
    (75, 'Ryttmästare Humle'), (90, 'Major Malt från Smedjebacken'), (110, 'Överstelöjtnant Ölstop'),
    (130, 'Överste Ölkorv'), (155, 'Brigadgeneral Bärs'), (180, 'Generalmajor Gambrinus'),
    (210, 'Generallöjtnant Guldskum'), (245, 'General Dalabärs'), (285, 'Fältmarskalk Fradga'),
    (330, 'Riksmarskalk Rundtur'), (380, 'Baron av Bryggstugan'), (430, 'Hertig av Humlegården'),
    (490, 'Ärkehertig av Ölkranen'), (560, 'Kung Kapsyl av Dalarna'), (640, 'Ölkejsaren'),
    (730, 'Bryggerilegenden'), (830, 'Halvguden från Väsman'), (920, 'Myten från Grängesberg'),
    (1000, 'Legenden från Ludvika'), (1100, 'Sagofiguren från Säfsnäs'), (1200, 'Oraklet i Ölstugan'),
    (1300, 'Överbefälhavare Öl'), (1500, 'Ölguden')
  ) as t(at, title);
$$;
revoke all on function public.olnu_titles() from public;

-- ---------------------------------------------------------------------------
-- 2. Tables (RLS on, no policies; only SECURITY DEFINER functions and the service role use them)
-- ---------------------------------------------------------------------------

-- Earned medals. count = how many times (stacking medals show "x3"). Never taken back.
create table if not exists public.user_medals (
  user_id    uuid not null,
  medal      text not null check (char_length(medal) between 1 and 40),
  earned_at  timestamptz not null default now(),
  count      int  not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, medal)
);
create index if not exists user_medals_user_idx on public.user_medals (user_id, earned_at);

-- One row per user per night (night = the 05:00 expiry). cell = a coarse region (~50 km),
-- never a precise place.
create table if not exists public.medal_nights (
  user_id  uuid not null,
  night    timestamptz not null,
  beers    int not null default 0,
  others   int not null default 0,
  first_at timestamptz,
  early    boolean not null default false,
  owl      boolean not null default false,
  home     boolean not null default false,
  cell     text,
  primary key (user_id, night)
);
create index if not exists medal_nights_night_idx on public.medal_nights (night);

-- Bars visited (check-ins and "Kung av baren" taps), per night.
create table if not exists public.medal_checkins (
  user_id uuid not null,
  bar_id  text not null,
  night   timestamptz not null,
  primary key (user_id, bar_id, night)
);

-- Lifetime counters.
create table if not exists public.medal_counts (
  user_id    uuid primary key,
  skal_given int not null default 0,
  skal_got   int not null default 0,
  msgs       int not null default 0
);

-- Client-reported low-stakes medals (whitelist in claim_medal), one per medal per night.
create table if not exists public.medal_claims (
  user_id uuid not null,
  medal   text not null,
  night   timestamptz not null,
  primary key (user_id, medal, night)
);

alter table public.user_medals    enable row level security;
alter table public.medal_nights   enable row level security;
alter table public.medal_checkins enable row level security;
alter table public.medal_counts   enable row level security;
alter table public.medal_claims   enable row level security;

revoke all on table public.user_medals, public.medal_nights, public.medal_checkins,
  public.medal_counts, public.medal_claims from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.user_medals, public.medal_nights, public.medal_checkins, public.medal_counts, public.medal_claims from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.user_medals, public.medal_nights, public.medal_checkins, public.medal_counts, public.medal_claims from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.user_medals, public.medal_nights, public.medal_checkins, public.medal_counts, public.medal_claims to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Helpers (internal)
-- ---------------------------------------------------------------------------

-- The night (next 05:00 Europe/Stockholm strictly after p).
create or replace function public.olnu_night_of(p timestamptz)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when (p at time zone 'Europe/Stockholm') >= date_trunc('day', p at time zone 'Europe/Stockholm') + interval '5 hours'
      then (date_trunc('day', p at time zone 'Europe/Stockholm') + interval '29 hours') at time zone 'Europe/Stockholm'
    else (date_trunc('day', p at time zone 'Europe/Stockholm') + interval '5 hours') at time zone 'Europe/Stockholm'
  end;
$$;

-- Evening date of a night (the day the night started).
create or replace function public.olnu_evening(p_night timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select ((p_night at time zone 'Europe/Stockholm') - interval '6 hours')::date;
$$;

-- Coarse region cell (~55 km x ~55 km): no precise place is ever stored here.
create or replace function public.olnu_cell(p_lat float8, p_lng float8)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_lat is null or p_lng is null then null
    else ((round(p_lat::numeric * 2) / 2)::numeric(6, 1))::text || ':' || (round(p_lng::numeric)::int)::text end;
$$;

revoke all on function public.olnu_night_of(timestamptz), public.olnu_evening(timestamptz),
  public.olnu_cell(float8, float8) from public;

-- ---------------------------------------------------------------------------
-- 4. Fact triggers (each catches its own errors)
-- ---------------------------------------------------------------------------

-- beers: tonight's beer / other-drink counts, first beer time, day/late hour flags, coarse cell.
create or replace function public.olnu_medal_beers_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ob int := 0;
  v_oo int := 0;
  v_h  int := extract(hour from (now() at time zone 'Europe/Stockholm'))::int;
begin
  begin
    if tg_op = 'UPDATE' then
      v_ob := coalesce(old.beer_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if coalesce(new.beer_count, 0) > v_ob then
      insert into public.medal_nights as m (user_id, night, beers, first_at, early, owl, cell)
      values (new.user_id, new.expires_at, new.beer_count, now(),
              v_h >= 5 and v_h < 16, v_h >= 1 and v_h < 5, public.olnu_cell(new.lat, new.lng))
      on conflict (user_id, night) do update
         set beers = greatest(m.beers, excluded.beers),
             first_at = coalesce(m.first_at, excluded.first_at),
             early = m.early or excluded.early,
             owl = m.owl or excluded.owl,
             cell = coalesce(m.cell, excluded.cell);
    end if;
    if coalesce(new.other_count, 0) > v_oo then
      insert into public.medal_nights as m (user_id, night, others)
      values (new.user_id, new.expires_at, new.other_count)
      on conflict (user_id, night) do update set others = greatest(m.others, excluded.others);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_medal_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_medal_beers_tg();

-- checkins (v10) and bar_taps (Kung av baren): bars visited per night.
create or replace function public.olnu_medal_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.medal_checkins (user_id, bar_id, night)
    values (new.user_id, left(new.bar_id, 80), public.olnu_night_of(now()))
    on conflict do nothing;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_medal_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_medal_checkin_tg();
create or replace trigger olnu_medal_bar_taps
  after insert or update on public.bar_taps
  for each row execute function public.olnu_medal_checkin_tg();

-- skals: given (caller) and received (beer owner).
create or replace function public.olnu_medal_skal_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  begin
    insert into public.medal_counts as c (user_id, skal_given) values (new.user_id, 1)
    on conflict (user_id) do update set skal_given = c.skal_given + 1;
    select b.user_id into v_owner from public.beers b where b.id = new.beer_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.medal_counts as c (user_id, skal_got) values (v_owner, 1)
      on conflict (user_id) do update set skal_got = c.skal_got + 1;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_medal_skals
  after insert on public.skals
  for each row execute function public.olnu_medal_skal_tg();

-- group_msgs: chat messages sent.
create or replace function public.olnu_medal_msg_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.medal_counts as c (user_id, msgs) values (new.user_id, 1)
    on conflict (user_id) do update set msgs = c.msgs + 1;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_medal_msgs
  after insert on public.group_msgs
  for each row execute function public.olnu_medal_msg_tg();

revoke all on function public.olnu_medal_beers_tg(), public.olnu_medal_checkin_tg(),
  public.olnu_medal_skal_tg(), public.olnu_medal_msg_tg() from public;

-- ---------------------------------------------------------------------------
-- 5. Backfill from what the server still has (only fills empty rows; safe to re-run)
-- ---------------------------------------------------------------------------
insert into public.medal_nights (user_id, night, beers, others, first_at, cell)
select b.user_id, b.expires_at, b.beer_count, coalesce(b.other_count, 0),
       case when b.beer_count > 0 then b.created_at end, public.olnu_cell(b.lat, b.lng)
  from public.beers b
 where b.beer_count > 0 or coalesce(b.other_count, 0) > 0
on conflict do nothing;

insert into public.medal_checkins (user_id, bar_id, night)
select t.user_id, left(t.bar_id, 80), public.olnu_night_of(t.last_at) from public.bar_taps t
on conflict do nothing;
insert into public.medal_checkins (user_id, bar_id, night)
select c.user_id, c.bar_id, c.expires_at from public.checkins c
on conflict do nothing;

insert into public.medal_counts (user_id, skal_given, skal_got, msgs)
select u.uid, coalesce(g.n, 0), coalesce(r.n, 0), coalesce(m.n, 0)
  from (select user_id as uid from public.skals
        union select b.user_id from public.skals s join public.beers b on b.id = s.beer_id
        union select user_id from public.group_msgs) u
  left join (select user_id, count(*)::int n from public.skals group by user_id) g on g.user_id = u.uid
  left join (select b.user_id, count(*)::int n from public.skals s join public.beers b on b.id = s.beer_id
              where s.user_id <> b.user_id group by b.user_id) r on r.user_id = u.uid
  left join (select user_id, count(*)::int n from public.group_msgs group by user_id) m on m.user_id = u.uid
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Rules: olnu_medal_eval(uid) -> (medal, n). n >= 1 = earned; n = stack count.
--    Medal ids (stable; the client has names and texts):
--    milestones: m1 m10 m50 m100 m250 m500 m1000      nights: n5 n25 n100
--    bars: b5 b15 b40, krogrunda, stammis            skål: sg10 sg100 sr10 sr100
--    rally: inryckt alltid trumslag                  home: hemvarn komhem
--    day/hours: dagsljus uggla tisdag                group: fortrupp kung liga pluton kompani
--    chat: radio signal                              holidays: valborg midsommar lucia nyar
--    travel: faltresa                                other: sidospar spoke vatten
--    "Varit med om" (hidden until earned, caring text, never a goal): het medevac
-- ---------------------------------------------------------------------------
create or replace function public.olnu_medal_eval(p_uid uuid)
returns table (medal text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total int := public.olnu_lifetime(p_uid);
  v_nights int; v_bars int; v_rounds int; v_regular int;
  v_sg int := 0; v_sr int := 0; v_msgs int := 0;
  v_yes int; v_rallies int; v_home int; v_day int; v_owl int; v_tue int;
  v_first int; v_king int; v_league int; v_cells int; v_side int; v_hot int; v_med int;
  v_valb int; v_mids int; v_luc int; v_nyar int; v_group int; v_comp int;
  v_week date := public.olnu_week_start(now());
begin
  select count(*) filter (where mn.beers >= 1),
         count(*) filter (where mn.beers >= 1 and mn.home),
         count(*) filter (where mn.beers >= 1 and mn.early),
         count(*) filter (where mn.beers >= 1 and mn.owl),
         count(*) filter (where mn.beers >= 1 and extract(isodow from public.olnu_evening(mn.night)) = 2),
         count(*) filter (where mn.others >= 1),
         count(*) filter (where mn.beers >= 5),
         count(*) filter (where mn.beers >= 10),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where mn.beers >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '04-30'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where mn.beers >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') between '06-19' and '06-25'
                   and extract(isodow from public.olnu_evening(mn.night)) = 5),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where mn.beers >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-13'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where mn.beers >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-31'),
         count(distinct mn.cell) filter (where mn.beers >= 1)
    into v_nights, v_home, v_day, v_owl, v_tue, v_side, v_hot, v_med, v_valb, v_mids, v_luc, v_nyar, v_cells
    from public.medal_nights mn where mn.user_id = p_uid;

  select count(distinct c.bar_id) into v_bars from public.medal_checkins c where c.user_id = p_uid;
  select count(*) into v_rounds from (
    select c.night from public.medal_checkins c where c.user_id = p_uid group by c.night having count(*) >= 3) x;
  select count(*) into v_regular from (
    select c.bar_id from public.medal_checkins c where c.user_id = p_uid group by c.bar_id having count(*) >= 5) x;

  select coalesce(mc.skal_given, 0), coalesce(mc.skal_got, 0), coalesce(mc.msgs, 0)
    into v_sg, v_sr, v_msgs from public.medal_counts mc where mc.user_id = p_uid;
  v_sg := coalesce(v_sg, 0); v_sr := coalesce(v_sr, 0); v_msgs := coalesce(v_msgs, 0);

  select count(*) into v_yes from public.rally_answers a join public.rallies r on r.id = a.rally_id
   where a.user_id = p_uid and a.answer = 'yes' and r.user_id <> p_uid;
  select count(*) into v_rallies from public.rallies r where r.user_id = p_uid;

  -- Förtruppen: first of the group out on a night where at least one group-mate was out too.
  select count(*) into v_first
    from public.medal_nights mn
   where mn.user_id = p_uid and mn.beers >= 1 and mn.first_at is not null
     and exists (select 1 from public.medal_nights o
                  where o.night = mn.night and o.beers >= 1 and o.user_id <> p_uid
                    and o.user_id in (select am.user_id from public.group_members am
                                        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid))
     and not exists (select 1 from public.medal_nights o
                      where o.night = mn.night and o.beers >= 1 and o.user_id <> p_uid and o.first_at < mn.first_at
                        and o.user_id in (select am.user_id from public.group_members am
                                            join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid));

  -- Barkung: king of a bar in a week (same rule as bar_kings).
  select count(*) into v_king from (
    select t.user_id, row_number() over (partition by t.bar_id, t.week order by t.n desc, t.last_at asc, t.user_id) as rn
      from public.bar_taps t
     where t.n > 0 and t.bar_id in (select x.bar_id from public.bar_taps x where x.user_id = p_uid)
  ) k where k.rn = 1 and k.user_id = p_uid;

  -- Ligamästare: one of my groups was number 1 in a finished week (last 26 weeks, current members).
  select count(*) into v_league from (
    select distinct on (s.wk) s.wk, s.gid
      from (select wb.week as wk, gm.group_id as gid, sum(wb.n) as tot, g.created_at as gat
              from public.week_beers wb
              join public.group_members gm on gm.user_id = wb.user_id
              join public.groups g on g.id = gm.group_id
             where wb.week < v_week and wb.week >= v_week - 182
               and gm.group_id in (select x.group_id from public.group_members x group by x.group_id having count(*) >= 2)
             group by wb.week, gm.group_id, g.created_at) s
     where s.tot > 0
     order by s.wk, s.tot desc, s.gat asc, s.gid
  ) top
   where top.gid in (select m.group_id from public.group_members m where m.user_id = p_uid);

  select count(*) into v_group from public.group_members m where m.user_id = p_uid;
  select count(*) into v_comp from public.groups g
   where g.created_by = p_uid
     and (select count(*) from public.group_members m where m.group_id = g.id) >= 5;

  return query
  select v.medal, v.n from (values
    ('m1', case when v_total >= 1 then 1 else 0 end),
    ('m10', case when v_total >= 10 then 1 else 0 end),
    ('m50', case when v_total >= 50 then 1 else 0 end),
    ('m100', case when v_total >= 100 then 1 else 0 end),
    ('m250', case when v_total >= 250 then 1 else 0 end),
    ('m500', case when v_total >= 500 then 1 else 0 end),
    ('m1000', case when v_total >= 1000 then 1 else 0 end),
    ('n5', case when v_nights >= 5 then 1 else 0 end),
    ('n25', case when v_nights >= 25 then 1 else 0 end),
    ('n100', case when v_nights >= 100 then 1 else 0 end),
    ('b5', case when v_bars >= 5 then 1 else 0 end),
    ('b15', case when v_bars >= 15 then 1 else 0 end),
    ('b40', case when v_bars >= 40 then 1 else 0 end),
    ('krogrunda', v_rounds),
    ('stammis', v_regular),
    ('sg10', case when v_sg >= 10 then 1 else 0 end),
    ('sg100', case when v_sg >= 100 then 1 else 0 end),
    ('sr10', case when v_sr >= 10 then 1 else 0 end),
    ('sr100', case when v_sr >= 100 then 1 else 0 end),
    ('inryckt', case when v_yes >= 1 then 1 else 0 end),
    ('alltid', case when v_yes >= 10 then 1 else 0 end),
    ('trumslag', case when v_rallies >= 1 then 1 else 0 end),
    ('hemvarn', v_home),
    ('komhem', case when v_home >= 5 then v_home / 5 else 0 end),
    ('dagsljus', v_day),
    ('uggla', v_owl),
    ('tisdag', v_tue),
    ('fortrupp', v_first),
    ('kung', v_king),
    ('liga', v_league),
    ('pluton', case when v_group >= 1 then 1 else 0 end),
    ('kompani', v_comp),
    ('radio', case when v_msgs >= 1 then 1 else 0 end),
    ('signal', case when v_msgs >= 50 then 1 else 0 end),
    ('valborg', v_valb),
    ('midsommar', v_mids),
    ('lucia', v_luc),
    ('nyar', v_nyar),
    ('faltresa', greatest(0, v_cells - 1)),
    ('sidospar', v_side),
    ('het', v_hot),
    ('medevac', v_med)
  ) as v(medal, n)
  union all
  select c.medal, count(*)::int from public.medal_claims c where c.user_id = p_uid group by c.medal;
end;
$$;
revoke all on function public.olnu_medal_eval(uuid) from public;

-- Store the result. Counts never go down; earned medals are never taken back.
create or replace function public.olnu_medal_store(p_uid uuid)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with e as (
    select x.medal as m, max(x.n)::int as n from public.olnu_medal_eval(p_uid) x where x.n >= 1 group by x.medal
  ),
  up as (
    insert into public.user_medals as um (user_id, medal, count, earned_at, updated_at)
    select p_uid, e.m, e.n, now(), now() from e
    on conflict on constraint user_medals_pkey do update
       set count = greatest(um.count, excluded.count), updated_at = now()
     where excluded.count > um.count
    returning um.medal, um.count, (um.earned_at = now()) as fresh, um.earned_at
  )
  select up.medal, up.count, up.fresh, up.earned_at from up;
end;
$$;
revoke all on function public.olnu_medal_store(uuid) from public;

-- ---------------------------------------------------------------------------
-- 7. RPCs (authenticated only)
-- ---------------------------------------------------------------------------

-- award_medals(p_event default null) -> setof (medal, count, is_new, earned_at): only the medals that
-- are new or whose count went up in this call. p_event = 'home': the caller pressed "Jag är hemma"
-- (counts only when the caller has a beer row tonight). Call after each beer, check-in, skål, chat,
-- rally answer and now and then while the app is open.
create or replace function public.award_medals(p_event text default null)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  if lower(btrim(coalesce(p_event, ''))) = 'home' then
    update public.medal_nights mn set home = true
      from public.beers b
     where b.user_id = v_uid and b.expires_at > now() and b.beer_count >= 1
       and mn.user_id = v_uid and mn.night = b.expires_at;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$$;

-- claim_medal(p_medal) -> setof (medal, count, is_new, earned_at). Only low-stakes medals the server
-- cannot see by itself. Unknown or not allowed ids -> raise invalid_medal. One claim per medal per night.
create or replace function public.claim_medal(p_medal text)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_m   text := lower(btrim(coalesce(p_medal, '')));
begin
  if v_m not in ('vatten', 'spoke', 'dagsljus', 'uggla', 'sidospar', 'hemvarn', 'radio', 'krogrunda') then
    raise exception 'invalid_medal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  -- Old local badges (migrated once): count only 1 per medal, ever, except "vatten" and "spoke".
  if v_m in ('vatten', 'spoke')
     or not exists (select 1 from public.medal_claims c where c.user_id = v_uid and c.medal = v_m) then
    insert into public.medal_claims (user_id, medal, night)
    values (v_uid, v_m, public.olnu_night_of(now()))
    on conflict do nothing;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$$;

-- my_medals() -> setof (medal, earned_at, count)
create or replace function public.my_medals()
returns table (medal text, earned_at timestamptz, count int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select um.medal, um.earned_at, um.count from public.user_medals um
   where um.user_id = v_uid order by um.earned_at, um.medal;
end;
$$;

-- member_medals(p_group_id) -> setof (name, is_me, medal, earned_at, count) for all members of a
-- group the caller is in. Error: not_member.
create or replace function public.member_medals(p_group_id uuid)
returns table (name text, is_me bool, medal text, earned_at timestamptz, count int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select gm.display_name, (gm.user_id = v_uid), um.medal, um.earned_at, um.count
    from public.group_members gm
    join public.user_medals um on um.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by gm.display_name, um.earned_at, um.medal
   limit 5000;
end;
$$;

do $$
declare
  f text;
  fns text[] := array[
    'public.award_medals(text)',
    'public.claim_medal(text)',
    'public.my_medals()',
    'public.member_medals(uuid)'
  ];
  internal text[] := array[
    'public.olnu_titles()',
    'public.olnu_night_of(timestamptz)',
    'public.olnu_evening(timestamptz)',
    'public.olnu_cell(float8, float8)',
    'public.olnu_medal_beers_tg()',
    'public.olnu_medal_checkin_tg()',
    'public.olnu_medal_skal_tg()',
    'public.olnu_medal_msg_tg()',
    'public.olnu_medal_eval(uuid)',
    'public.olnu_medal_store(uuid)'
  ];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
  foreach f in array internal loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;
end $$;

-- ===== supabase/migrations/0013_owner_stats.sql =====
-- Öl Nu v12: OWNER STATS. Additive. Safe to run again.
-- An owner-only statistics page (docs/stats.html, not linked from the app) calls owner_stats(p_key).
-- There is no login: the owner holds a secret key. Only its SHA-256 hash is stored (owner_keys).
-- owner_stats returns ONE jsonb with aggregates only: no names, no exact locations, no user ids.
-- Wrong key: the failure is logged in owner_key_fails, HTTP status 403, body {"message":"forbidden"}
-- (a raised exception would roll back the log row, so the function sets response.status instead).
-- More than 20 failures in the last hour: raise 'rate_limited' (also for the right key).
-- Peak hours need more history than beer_events keeps (about 10 days), so a small trigger on
-- beer_events counts beers per hour in owner_hours (no user id, no place).
-- This file has no remove-type statements on purpose (create-or-replace, "if not exists",
-- "on conflict" only). Needs 0001-0012 first (uses medal_nights / medal_checkins when present).
-- To add a key (plain key never stored):
--   insert into public.owner_keys (key_hash) values (encode(extensions.digest('<key>', 'sha256'), 'hex'));

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS on, no policies, no client access)
-- ---------------------------------------------------------------------------
create table if not exists public.owner_keys (
  key_hash   text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.owner_key_fails (
  at timestamptz not null default now()
);
create index if not exists owner_key_fails_at_idx on public.owner_key_fails (at);

create table if not exists public.owner_hours (
  hour  timestamptz primary key,
  beers int not null default 0
);

alter table public.owner_keys      enable row level security;
alter table public.owner_key_fails enable row level security;
alter table public.owner_hours     enable row level security;

revoke all on table public.owner_keys, public.owner_key_fails, public.owner_hours from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.owner_keys, public.owner_key_fails, public.owner_hours from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.owner_keys, public.owner_key_fails, public.owner_hours from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.owner_keys, public.owner_key_fails, public.owner_hours to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Hour counter (trigger on beer_events; catches its own errors)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_owner_hours_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.kind = 'beer' then
      insert into public.owner_hours as h (hour, beers)
      values (date_trunc('hour', coalesce(new.created_at, now())), 1)
      on conflict (hour) do update set beers = h.beers + 1;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_owner_hours
  after insert on public.beer_events
  for each row execute function public.olnu_owner_hours_tg();

-- Backfill from what beer_events still has (only fills empty hours; safe to re-run).
insert into public.owner_hours (hour, beers)
select date_trunc('hour', e.created_at), count(*)::int
  from public.beer_events e
 where e.kind = 'beer'
 group by 1
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Internal helper: one row per (night, user) since p_first (medal_nights + beers rows).
-- ---------------------------------------------------------------------------
create or replace function public.olnu_owner_un(p_first timestamptz)
returns table (night timestamptz, user_id uuid, b int, o int, home bool)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.medal_nights') is not null then
    return query
    select x.night, x.user_id, max(x.b)::int, max(x.o)::int, bool_or(x.home)
      from (select mn.night, mn.user_id, mn.beers b, mn.others o, mn.home
              from public.medal_nights mn where mn.night >= p_first
            union all
            select bb.expires_at, bb.user_id, coalesce(bb.beer_count, 0),
                   coalesce(bb.other_count, 0) + coalesce(bb.shot_count, 0), false
              from public.beers bb where bb.expires_at >= p_first) x
     group by 1, 2;
  else
    return query
    select bb.expires_at, bb.user_id, coalesce(bb.beer_count, 0)::int,
           (coalesce(bb.other_count, 0) + coalesce(bb.shot_count, 0))::int, false
      from public.beers bb where bb.expires_at >= p_first;
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- 4. owner_stats(p_key) -> jsonb
-- ---------------------------------------------------------------------------
create or replace function public.owner_stats(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now       timestamptz := now();
  v_tz        text := 'Europe/Stockholm';
  v_next      timestamptz := public.olnu_next_expiry();          -- end of tonight (05:00)
  v_next_loc  timestamp := public.olnu_next_expiry() at time zone 'Europe/Stockholm';
  v_first     timestamptz;                                       -- end of the oldest of 30 nights
  v_today     timestamptz := date_trunc('day', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm';
  v_medals    boolean := to_regclass('public.medal_nights') is not null;
  v_mcheck    boolean := to_regclass('public.medal_checkins') is not null;
  v_users     jsonb;
  v_beers     jsonb;
  v_places    jsonb;
  v_social    jsonb;
  v_care      jsonb;
  v_tech      jsonb := '{}'::jsonb;
  v_nights    jsonb;
  v_hours     jsonb;
  v_n         bigint;
  r           record;
begin
  if (select count(*) from public.owner_key_fails f where f.at > v_now - interval '1 hour') > 20 then
    raise exception 'rate_limited';
  end if;

  if p_key is null or char_length(p_key) > 200 or not exists (
       select 1 from public.owner_keys k
        where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    insert into public.owner_key_fails (at) values (v_now);
    perform set_config('response.status', '403', true);
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;

  v_first := (v_next_loc - interval '29 days') at time zone v_tz;

  -- Per night series (oldest first). beer_events gives exact beer counts for recent nights.
  select coalesce(jsonb_agg(jsonb_build_object(
           'night', to_char(((g.night at time zone v_tz) - interval '6 hours')::date, 'YYYY-MM-DD'),
           'beers', greatest(coalesce(u.b, 0), coalesce(e.b, 0)),
           'others', coalesce(u.o, 0),
           'people', coalesce(u.p, 0),
           'hot', greatest(coalesce(u.hot, 0), coalesce(e.hot, 0)),
           'medevac', greatest(coalesce(u.med, 0), coalesce(e.med, 0)),
           'home', coalesce(u.home, 0)
         ) order by g.night), '[]'::jsonb)
    into v_nights
    from (select (v_next_loc - make_interval(days => k)) at time zone v_tz as night
            from generate_series(0, 29) k) g
    left join (select night, sum(b)::int b, sum(o)::int o,
                      count(*) filter (where b > 0 or o > 0)::int p,
                      count(*) filter (where b >= 5)::int hot,
                      count(*) filter (where b >= 10)::int med,
                      count(*) filter (where home)::int home
                 from public.olnu_owner_un(v_first) group by night) u on u.night = g.night
    left join (select expires_at night, count(*)::int b,
                      count(*) filter (where n = 5)::int hot,
                      count(*) filter (where n = 10)::int med
                 from public.beer_events where kind = 'beer' and expires_at >= v_first
                group by 1) e on e.night = g.night;

  -- Users
  select jsonb_build_object(
    'total', (select count(*) from auth.users),
    'named', (select count(distinct user_id) from public.group_members),
    'new_today', (select count(*) from auth.users where created_at >= v_today),
    'new_7d', (select count(*) from auth.users where created_at > v_now - interval '7 days'),
    'new_30d', (select count(*) from auth.users where created_at > v_now - interval '30 days'),
    'active_tonight', (select count(distinct uid) from (
        select user_id uid from public.beers
         where expires_at = v_next and (coalesce(beer_count, 0) + coalesce(other_count, 0) + coalesce(shot_count, 0)) > 0
        union all
        select user_id from public.checkins where expires_at = v_next) a),
    'out_now', (select count(*) from public.beers where expires_at > v_now and not coalesce(stopped, false)),
    'active_7d', (select count(distinct uid) from (
        select user_id uid from public.olnu_owner_un(v_first) where night > v_now - interval '7 days' and (b > 0 or o > 0)
        union all select user_id from public.checkins where created_at > v_now - interval '7 days'
        union all select user_id from public.group_msgs where created_at > v_now - interval '7 days'
        union all select user_id from public.skals where created_at > v_now - interval '7 days'
        union all select user_id from public.reactions where updated_at > v_now - interval '7 days'
        union all select user_id from public.rally_answers where updated_at > v_now - interval '7 days') a),
    'opened_7d', (select count(distinct user_id) from auth.sessions where updated_at > v_now - interval '7 days'),
    'push', (select count(distinct user_id) from public.push_subscriptions)
  ) into v_users;

  -- Peak hours (Stockholm), last 30 days
  select coalesce(jsonb_agg(coalesce(h.n, 0) order by g.hr), '[]'::jsonb) into v_hours
    from generate_series(0, 23) g(hr)
    left join (select extract(hour from (hour at time zone v_tz))::int hr, sum(beers)::int n
                 from public.owner_hours where hour > v_now - interval '30 days' group by 1) h on h.hr = g.hr;

  -- Beers
  select jsonb_build_object(
    'tonight', (v_nights -> 29 ->> 'beers')::int,
    'others_tonight', (v_nights -> 29 ->> 'others')::int,
    'last_night', (v_nights -> 28 ->> 'beers')::int,
    'per_night', v_nights,
    'all_time', greatest(
        (select coalesce(sum(n), 0) from public.week_beers),
        (select count(*) from public.beer_events where kind = 'beer'),
        case when v_medals then (select coalesce(sum(beers), 0) from public.medal_nights) else 0 end),
    'avg_per_person', (select round(avg(b)::numeric, 2) from public.olnu_owner_un(v_first) where b > 0),
    'peak_hours', v_hours
  ) into v_beers;

  -- Places (bar name + count only)
  select jsonb_build_object(
    'top_bars', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'beers', t.beers, 'checkins', t.ch)
                          order by t.beers desc, t.ch desc, t.name), '[]'::jsonb)
                   from (select coalesce(bt.name, ck.name) as name, coalesce(bt.n, 0) beers, coalesce(ck.n, 0) ch
                           from (select bar_id, max(bar_name) name, sum(n)::int n from public.bar_taps
                                  where week >= public.olnu_week_start(v_now - interval '30 days') group by bar_id) bt
                           full join (select bar_id, max(bar_name) name, count(*)::int n from public.checkins
                                       where created_at > v_now - interval '30 days' group by bar_id) ck
                             on ck.bar_id = bt.bar_id
                          order by 2 desc, 3 desc, 1
                          limit 10) t),
    'checkins_tonight', (select count(*) from public.checkins where expires_at = v_next),
    'checkins_30d', case when v_mcheck
        then (select count(*) from public.medal_checkins where night >= v_first)
        else (select count(*) from public.checkins where created_at > v_now - interval '30 days') end,
    'checkin_users_30d', (select count(*) from public.checkins where created_at > v_now - interval '30 days')
  ) into v_places;

  -- Social
  select jsonb_build_object(
    'groups', (select count(*) from public.groups),
    'groups_2plus', (select count(*) from (select group_id from public.group_members group by 1 having count(*) >= 2) g),
    'avg_group_size', (select round(avg(c)::numeric, 1) from (select count(*) c from public.group_members group by group_id) g),
    'msgs_7d', (select count(*) from public.group_msgs where created_at > v_now - interval '7 days'),
    'skal_7d', (select count(*) from public.skals where created_at > v_now - interval '7 days'),
    'rallies_7d', (select count(*) from public.rallies where created_at > v_now - interval '7 days'),
    'reactions_7d', (select count(*) from public.reactions where created_at > v_now - interval '7 days')
  ) into v_social;

  -- Care
  select jsonb_build_object(
    'hot_tonight', (select count(*) from public.beers where expires_at = v_next and beer_count >= 5 and beer_count < 10),
    'medevac_tonight', (select count(*) from public.beers where expires_at = v_next and beer_count >= 10),
    'home_7d', (select coalesce(sum((x ->> 'home')::int), 0)
                  from jsonb_array_elements(v_nights) with ordinality as a(x, i) where a.i > 23),
    'home_tracked', v_medals
  ) into v_care;

  -- Tech: row counts of every public table (+ auth.users)
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select count(*) from public.%I', r.tablename) into v_n;
    v_tech := v_tech || jsonb_build_object(r.tablename, v_n);
  end loop;
  v_tech := v_tech || jsonb_build_object('auth.users', (select count(*) from auth.users));

  return jsonb_build_object(
    'generated_at', v_now,
    'night_ends', v_next,
    'users', v_users,
    'beers', v_beers,
    'places', v_places,
    'social', v_social,
    'care', v_care,
    'tech', v_tech
  );
end;
$$;

revoke all on function public.owner_stats(text) from public;
revoke all on function public.olnu_owner_hours_tg() from public;
revoke all on function public.olnu_owner_un(timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.owner_stats(text) to anon';
    execute 'revoke all on function public.olnu_owner_hours_tg() from anon';
    execute 'revoke all on function public.olnu_owner_un(timestamptz) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.owner_stats(text) to authenticated';
    execute 'revoke all on function public.olnu_owner_hours_tg() from authenticated';
    execute 'revoke all on function public.olnu_owner_un(timestamptz) from authenticated';
  end if;
end $$;
