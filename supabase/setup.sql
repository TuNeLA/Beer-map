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

-- ===== supabase/migrations/0014_bars_plus.sql =====
-- Öl Nu v12: KROGARNA (omgång 1). Additive. Safe to run again.
-- 1. Kö-rapport: "Ingen kö / Kort kö / Lång kö" (+ optional entry price) per bar. A report lives 30 min.
-- 2. Kvällens erbjudande: short offer text per bar for tonight (until 05:00), 👍 / 👎 votes.
--    Legal (Alkohollagen 7 kap.): offers are user-written and passive. They are only returned by
--    bar_status() for the bar popup: no push, no ticker, no medal for offers.
-- 3. Ölsorter: optional beer type for the caller's latest beer tonight + anonymous type stats.
-- 4. Ta över krogen: the group with most people at a bar tonight "owns" it. Group name is public
--    only when the group opted in (group_flags.show_on_map, default off).
-- 5. Krogtips: "📣 Anton tipsar: Kom till Pitchers!" as a group chat message (+ push by notify-group).
-- 6. Four new medals (olnu_medal_eval_bars, merged into olnu_medal_store; same return type).
-- No old RPC, parameter or returned field changes. Old rows are never removed: every read filters on
-- time (expires_at / night). This file has no remove-type statements on purpose (create-or-replace,
-- "if not exists", "on conflict" only).
-- Needs 0001-0013 first. Postgres 14+.

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS on, no policies; only SECURITY DEFINER functions and the service role use them)
-- ---------------------------------------------------------------------------

-- Queue reports. bar_lat/bar_lng = the bar position the client sent (bars.json).
create table if not exists public.bar_queue (
  id         bigserial primary key,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  user_id    uuid not null,
  queue      text not null check (queue in ('none', 'short', 'long')),
  entry      text check (entry in ('free', 'low', 'high')),
  bar_lat    float8 not null,
  bar_lng    float8 not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);
create index if not exists bar_queue_bar_idx on public.bar_queue (bar_id, expires_at);
create index if not exists bar_queue_exp_idx on public.bar_queue (expires_at);
create index if not exists bar_queue_user_idx on public.bar_queue (user_id, bar_id, created_at);

-- Tonight's offers. night = the 05:00 expiry.
create table if not exists public.bar_offers (
  id         bigserial primary key,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  bar_name   text not null check (char_length(bar_name) between 1 and 60),
  user_id    uuid not null,
  body       text not null check (char_length(body) between 1 and 60),
  bar_lat    float8 not null,
  bar_lng    float8 not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default public.olnu_next_expiry()
);
create index if not exists bar_offers_bar_idx on public.bar_offers (bar_id, expires_at);
create index if not exists bar_offers_exp_idx on public.bar_offers (expires_at);
create index if not exists bar_offers_user_idx on public.bar_offers (user_id, expires_at);

-- Votes on offers: 1 = "👍 stämmer", -1 = "👎 stämmer inte", 0 = taken back.
create table if not exists public.bar_offer_votes (
  offer_id   bigint not null,
  user_id    uuid not null,
  vote       smallint not null check (vote in (-1, 0, 1)),
  updated_at timestamptz not null default now(),
  primary key (offer_id, user_id)
);

-- Beer type per beer (n = beer number tonight). lat/lng rounded to 0.01 (~1 km), only for town stats.
create table if not exists public.beer_types (
  user_id    uuid not null,
  night      timestamptz not null,
  n          int not null,
  type       text not null check (type in ('lager', 'pilsner', 'ipa', 'apa', 'stout', 'vete', 'ale', 'sour', 'alkfri', 'annan')),
  lat        float8,
  lng        float8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, night, n)
);
create index if not exists beer_types_night_idx on public.beer_types (night);
create index if not exists beer_types_created_idx on public.beer_types (created_at);

-- Group settings. show_on_map: the group name may be shown to everyone on a bar it owns.
create table if not exists public.group_flags (
  group_id    uuid primary key,
  show_on_map boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Takeover log (one row per group per bar per night). Used for the push and the "Erövraren" medal.
create table if not exists public.bar_takeovers (
  id         bigserial primary key,
  group_id   uuid not null,
  bar_id     text not null,
  bar_name   text,
  night      timestamptz not null,
  n          int not null default 0,
  created_at timestamptz not null default now(),
  notified   boolean not null default false,
  unique (group_id, bar_id, night)
);
create index if not exists bar_takeovers_group_idx on public.bar_takeovers (group_id, created_at);

-- Bar tips sent to a group (the chat row is in group_msgs).
create table if not exists public.bar_tips (
  id         bigserial primary key,
  user_id    uuid not null,
  group_id   uuid not null,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  bar_name   text not null check (char_length(bar_name) between 1 and 60),
  body       text,
  msg_id     bigint,
  created_at timestamptz not null default now(),
  notified   boolean not null default false
);
create index if not exists bar_tips_user_idx on public.bar_tips (user_id, created_at);

alter table public.bar_queue       enable row level security;
alter table public.bar_offers      enable row level security;
alter table public.bar_offer_votes enable row level security;
alter table public.beer_types      enable row level security;
alter table public.group_flags     enable row level security;
alter table public.bar_takeovers   enable row level security;
alter table public.bar_tips        enable row level security;

revoke all on table public.bar_queue, public.bar_offers, public.bar_offer_votes, public.beer_types,
  public.group_flags, public.bar_takeovers, public.bar_tips from public;
revoke all on sequence public.bar_queue_id_seq, public.bar_offers_id_seq, public.bar_takeovers_id_seq,
  public.bar_tips_id_seq from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.bar_queue, public.bar_offers, public.bar_offer_votes, public.beer_types, public.group_flags, public.bar_takeovers, public.bar_tips from anon';
    execute 'revoke all on sequence public.bar_queue_id_seq, public.bar_offers_id_seq, public.bar_takeovers_id_seq, public.bar_tips_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.bar_queue, public.bar_offers, public.bar_offer_votes, public.beer_types, public.group_flags, public.bar_takeovers, public.bar_tips from authenticated';
    execute 'revoke all on sequence public.bar_queue_id_seq, public.bar_offers_id_seq, public.bar_takeovers_id_seq, public.bar_tips_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.bar_queue, public.bar_offers, public.bar_offer_votes, public.beer_types, public.group_flags, public.bar_takeovers, public.bar_tips to service_role';
    execute 'grant all on sequence public.bar_queue_id_seq, public.bar_offers_id_seq, public.bar_takeovers_id_seq, public.bar_tips_id_seq to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers (internal, not callable by clients)
-- ---------------------------------------------------------------------------

-- Control chars -> space, runs of spaces -> one, trimmed.
create or replace function public.olnu_bp_clean(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- true when (lat, lng) is a real point inside the Sweden bbox.
create or replace function public.olnu_bp_in_sweden(p_lat float8, p_lng float8)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between 55.0 and 69.1 and p_lng between 10.9 and 24.2;
$$;

-- Checks a bar + the caller's position. Raises invalid_bar, outside_sweden or too_far (> 300 m).
create or replace function public.olnu_bp_check(p_bar_id text, p_bar_name text, p_bar_lat float8, p_bar_lng float8,
                                                p_lat float8, p_lng float8)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_name text := public.olnu_bp_clean(p_bar_name);
begin
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_bar';
  end if;
  if not public.olnu_bp_in_sweden(p_bar_lat, p_bar_lng) or not public.olnu_bp_in_sweden(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if public.olnu_dist_m(p_bar_lat, p_bar_lng, p_lat, p_lng) > 300 then
    raise exception 'too_far';
  end if;
end;
$$;

-- true when a short public text has a link, an e-mail, a phone number or a bad word.
create or replace function public.olnu_bp_blocked(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p, '') ~* '(https?:|www\.|://|@|\.(se|com|nu|net|org|io|app|info|biz|ly|me|co|eu)(\M|/))'
      or regexp_replace(coalesce(p, ''), '[\s().+–-]', '', 'g') ~ '[0-9]{7,}'
      or coalesce(p, '') ~* '\m(hora|horor|horan|fitta|fittor|fittan|kuk|kukar|kuken|knulla|knullar|neger|negrer|nigger|niggers|nigga|blatte|blattar|svartskalle|zigge|bögjävel|retard|mongo|cunt|whore|faggot|nazi|sieg heil|våldta|våldtäkt|rape|kill yourself)\M';
$$;

-- Bar ids from tonight's check-ins and "Kung av baren" taps, with the bar position.
-- Precise live beers within 75 m of the nearest such bar count as "at the bar".
-- olnu_takeovers() -> (bar_id, bar_name, group_id, n, since): the owner group of each bar tonight.
-- Owner = the group with most different members at the bar (at least 2); a member is at one bar only
-- (the newest of his check-in and his precise beer). Tie: the group that got there first keeps it.
create or replace function public.olnu_takeovers()
returns table (bar_id text, bar_name text, group_id uuid, n int, since timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz := public.olnu_next_expiry() - interval '24 hours';
begin
  return query
  with cand as (
    select distinct on (x.bid) x.bid, x.bname, x.blat, x.blng from (
      select c.bar_id as bid, c.bar_name as bname, c.lat as blat, c.lng as blng, c.created_at as at
        from public.checkins c where c.expires_at > now()
      union all
      select t.bar_id, t.bar_name, t.lat, t.lng, t.last_at
        from public.bar_taps t
       where t.last_at >= v_start and t.lat is not null and t.lng is not null
         and t.week >= public.olnu_week_start(now()) - 7
    ) x
    order by x.bid, x.at desc
  ),
  pres as (
    select c.user_id as uid, c.bar_id as bid, c.created_at as at
      from public.checkins c
     where c.expires_at > now()
    union all
    select b.user_id, nb.bid, coalesce(b.beer_at, b.updated_at)
      from public.beers b
      cross join lateral (
        select cb.bid from cand cb
         where abs(cb.blat - b.lat) < 0.001 and abs(cb.blng - b.lng) < 0.002
           and public.olnu_dist_m(cb.blat, cb.blng, b.lat, b.lng) <= 75
         order by public.olnu_dist_m(cb.blat, cb.blng, b.lat, b.lng)
         limit 1
      ) nb
     where b.expires_at > now() and not b.stopped and b.precise and b.beer_count >= 1
  ),
  one as (
    select distinct on (p.uid) p.uid, p.bid, p.at from pres p order by p.uid, p.at desc
  ),
  gp as (
    select o.bid, gm.group_id as gid, count(distinct o.uid)::int as cnt, min(o.at) as first_at
      from one o
      join public.group_members gm on gm.user_id = o.uid
     group by o.bid, gm.group_id
    having count(distinct o.uid) >= 2
  ),
  ranked as (
    select gp.*, row_number() over (partition by gp.bid order by gp.cnt desc, gp.first_at asc, gp.gid) as rn
      from gp
  )
  select r.bid, cand.bname, r.gid, r.cnt, r.first_at
    from ranked r
    left join cand on cand.bid = r.bid
   where r.rn = 1;
end;
$$;

-- Can the user change this group's settings? The creator; if the creator left: the oldest member.
create or replace function public.olnu_group_admin(p_group_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p_uid)
     and (
       exists (select 1 from public.groups g where g.id = p_group_id and g.created_by = p_uid)
       or (
         not exists (select 1 from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = g.created_by
                      where g.id = p_group_id)
         and p_uid = (select m.user_id from public.group_members m where m.group_id = p_group_id
                       order by m.joined_at, m.user_id limit 1)
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- report_queue(bar, bar position, caller position, queue, entry) -> jsonb {ok, wait_seconds, queue, entry, reports}
-- queue: none | short | long (else invalid_queue). entry: null/'' | free | low (< 100 kr) | high (100+ kr)
-- (else invalid_entry). Caller within 300 m of the bar (else too_far). 1 report per user per bar per 10 min:
-- ok=false + wait_seconds. A report lives 30 min. Returns the bar's current queue after the call.
create or replace function public.report_queue(p_bar_id text, p_bar_name text, p_bar_lat float8, p_bar_lng float8,
                                               p_lat float8, p_lng float8, p_queue text, p_entry text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_id    text := public.olnu_bp_clean(p_bar_id);
  v_q     text := lower(btrim(coalesce(p_queue, '')));
  v_e     text := nullif(lower(btrim(coalesce(p_entry, ''))), '');
  v_last  timestamptz;
  v_ok    boolean := true;
  v_wait  int := 0;
  v_res   record;
begin
  if v_q not in ('none', 'short', 'long') then raise exception 'invalid_queue'; end if;
  if v_e is not null and v_e not in ('free', 'low', 'high') then raise exception 'invalid_entry'; end if;
  perform public.olnu_bp_check(p_bar_id, p_bar_name, p_bar_lat, p_bar_lng, p_lat, p_lng);

  perform pg_advisory_xact_lock(hashtextextended('olnu_queue:' || v_uid::text, 0));
  select max(q.created_at) into v_last from public.bar_queue q
   where q.user_id = v_uid and q.bar_id = v_id and q.created_at > now() - interval '10 minutes';
  if v_last is not null then
    v_ok := false;
    v_wait := greatest(1, ceil(extract(epoch from (v_last + interval '10 minutes' - now())))::int);
  else
    insert into public.bar_queue (bar_id, user_id, queue, entry, bar_lat, bar_lng)
    values (v_id, v_uid, v_q, v_e, round(p_bar_lat::numeric, 5)::float8, round(p_bar_lng::numeric, 5)::float8);
  end if;

  select * into v_res from public.olnu_bar_queue_now(v_id);
  return jsonb_build_object('ok', v_ok, 'wait_seconds', v_wait, 'queue', v_res.queue, 'entry', v_res.entry,
                            'reports', coalesce(v_res.reports, 0));
end;
$$;

-- Current queue of one bar: the answer with most live reports; tie -> the newest report wins.
create or replace function public.olnu_bar_queue_now(p_bar_id text)
returns table (queue text, entry text, reports int, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select q.queue, q.entry, q.created_at from public.bar_queue q
     where q.bar_id = p_bar_id and q.expires_at > now()
  )
  select (select l.queue from live l group by l.queue order by count(*) desc, max(l.created_at) desc limit 1),
         (select l.entry from live l where l.entry is not null group by l.entry order by count(*) desc, max(l.created_at) desc limit 1),
         (select count(*)::int from live),
         (select max(l.created_at) from live l);
$$;

-- add_offer(bar, bar position, caller position, body) -> jsonb {ok, id}
-- Body cleaned, 3-60 chars (else invalid_offer). Links, e-mails, phone numbers, bad words -> offer_blocked.
-- Caller within 300 m (else too_far). Max 2 new offers per user per night -> slow_down.
-- The same text twice at the same bar tonight -> the old offer id comes back (ok=true).
create or replace function public.add_offer(p_bar_id text, p_bar_name text, p_bar_lat float8, p_bar_lng float8,
                                            p_lat float8, p_lng float8, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_name text := public.olnu_bp_clean(p_bar_name);
  v_body text := public.olnu_bp_clean(p_body);
  v_n    int;
  v_old  bigint;
  v_new  bigint;
begin
  if char_length(v_body) < 3 or char_length(v_body) > 60 then raise exception 'invalid_offer'; end if;
  if public.olnu_bp_blocked(v_body) then raise exception 'offer_blocked'; end if;
  perform public.olnu_bp_check(p_bar_id, p_bar_name, p_bar_lat, p_bar_lng, p_lat, p_lng);

  perform pg_advisory_xact_lock(hashtextextended('olnu_offer:' || v_uid::text, 0));
  select o.id into v_old from public.bar_offers o
   where o.bar_id = v_id and o.expires_at > now() and lower(o.body) = lower(v_body)
   order by o.id limit 1;
  if v_old is not null then
    return jsonb_build_object('ok', true, 'id', v_old, 'is_new', false);
  end if;
  select count(*) into v_n from public.bar_offers o where o.user_id = v_uid and o.expires_at > now();
  if v_n >= 2 then raise exception 'slow_down'; end if;

  insert into public.bar_offers (bar_id, bar_name, user_id, body, bar_lat, bar_lng, expires_at)
  values (v_id, v_name, v_uid, v_body, round(p_bar_lat::numeric, 5)::float8, round(p_bar_lng::numeric, 5)::float8,
          public.olnu_next_expiry())
  returning id into v_new;
  return jsonb_build_object('ok', true, 'id', v_new, 'is_new', true);
end;
$$;

-- vote_offer(p_offer_id, p_vote) -> jsonb {up, down, mine, hidden}
-- p_vote: 1 (👍), -1 (👎), 0 (take back); else invalid_vote. Offer must be live (else offer_not_found).
-- Own offer -> own_offer. hidden = 3 or more 👎 than 👍.
create or replace function public.vote_offer(p_offer_id bigint, p_vote int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_o   public.bar_offers%rowtype;
  v_up  int; v_dn int; v_me int;
begin
  if p_vote is null or p_vote not in (-1, 0, 1) then raise exception 'invalid_vote'; end if;
  select * into v_o from public.bar_offers o where o.id = p_offer_id and o.expires_at > now();
  if not found then raise exception 'offer_not_found'; end if;
  if v_o.user_id = v_uid then raise exception 'own_offer'; end if;
  insert into public.bar_offer_votes as v (offer_id, user_id, vote, updated_at)
  values (p_offer_id, v_uid, p_vote, now())
  on conflict (offer_id, user_id) do update set vote = excluded.vote, updated_at = now();
  select count(*) filter (where v.vote = 1), count(*) filter (where v.vote = -1)
    into v_up, v_dn from public.bar_offer_votes v where v.offer_id = p_offer_id;
  v_me := p_vote;
  return jsonb_build_object('up', v_up, 'down', v_dn, 'mine', v_me, 'hidden', (v_dn - v_up) >= 3);
end;
$$;

-- bar_status() -> setof (bar_id, queue, queue_at, queue_n, entry, offers jsonb, owner_name, owner_n,
--                       owner_mine, owner_named)
-- One row per bar with live queue reports, live (not hidden) offers or an owner group tonight. Max 2000.
-- offers: up to 3, best first: [{id, body, up, down, my_vote, is_mine, at}]. Hidden offers (3+ more 👎
-- than 👍) are left out. owner_name: the group name when the group opted in (group_flags.show_on_map)
-- or the caller is a member; else null ("En grupp"). owner_named = the group opted in.
create or replace function public.bar_status()
returns table (bar_id text, queue text, queue_at timestamptz, queue_n int, entry text, offers jsonb,
               owner_name text, owner_n int, owner_mine bool, owner_named bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with q as (
    select x.bar_id as bid,
           (select l.queue from public.bar_queue l where l.bar_id = x.bar_id and l.expires_at > now()
             group by l.queue order by count(*) desc, max(l.created_at) desc limit 1) as qv,
           (select l.entry from public.bar_queue l where l.bar_id = x.bar_id and l.expires_at > now() and l.entry is not null
             group by l.entry order by count(*) desc, max(l.created_at) desc limit 1) as ev,
           max(x.created_at) as qat, count(*)::int as qn
      from public.bar_queue x
     where x.expires_at > now()
     group by x.bar_id
  ),
  ov as (
    select o.id, o.bar_id as bid, o.body, o.user_id, o.created_at,
           coalesce(sum(case when v.vote = 1 then 1 else 0 end), 0)::int as up,
           coalesce(sum(case when v.vote = -1 then 1 else 0 end), 0)::int as dn,
           coalesce(max(case when v.user_id = v_uid then v.vote end), 0)::int as mv
      from public.bar_offers o
      left join public.bar_offer_votes v on v.offer_id = o.id
     where o.expires_at > now()
     group by o.id
  ),
  ovr as (
    select ov.*, row_number() over (partition by ov.bid order by (ov.up - ov.dn) desc, ov.created_at desc, ov.id) as rn
      from ov where (ov.dn - ov.up) < 3
  ),
  oj as (
    select ovr.bid, jsonb_agg(jsonb_build_object('id', ovr.id, 'body', ovr.body, 'up', ovr.up, 'down', ovr.dn,
             'my_vote', ovr.mv, 'is_mine', ovr.user_id = v_uid, 'at', ovr.created_at) order by ovr.rn) as js
      from ovr where ovr.rn <= 3 group by ovr.bid
  ),
  tk as (
    select t.bar_id as bid, t.group_id as gid, t.n as cnt,
           coalesce(f.show_on_map, false) as named,
           exists (select 1 from public.group_members m where m.group_id = t.group_id and m.user_id = v_uid) as mine
      from public.olnu_takeovers() t
      left join public.group_flags f on f.group_id = t.group_id
  ),
  ids as (select q.bid from q union select oj.bid from oj union select tk.bid from tk)
  select ids.bid, q.qv, q.qat, coalesce(q.qn, 0), q.ev, coalesce(oj.js, '[]'::jsonb),
         case when tk.gid is not null and (tk.named or tk.mine) then (select g.name from public.groups g where g.id = tk.gid) end,
         coalesce(tk.cnt, 0), coalesce(tk.mine, false), coalesce(tk.named, false)
    from ids
    left join q on q.bid = ids.bid
    left join oj on oj.bid = ids.bid
    left join tk on tk.bid = ids.bid
   order by ids.bid
   limit 2000;
end;
$$;

-- note_takeover(p_bar_id) -> jsonb {ok, is_new}
-- The client calls this when bar_status says the caller's group owns a bar. ok = one of the caller's
-- groups owns it now. is_new = first time tonight for that group and bar (then call notify-group
-- {event:"takeover", bar_id}).
create or replace function public.note_takeover(p_bar_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id  text := public.olnu_bp_clean(p_bar_id);
  v_t   record;
  v_new int := 0;
begin
  select t.* into v_t from public.olnu_takeovers() t
   where t.bar_id = v_id
     and exists (select 1 from public.group_members m where m.group_id = t.group_id and m.user_id = v_uid);
  if not found then
    return jsonb_build_object('ok', false, 'is_new', false);
  end if;
  insert into public.bar_takeovers (group_id, bar_id, bar_name, night, n)
  values (v_t.group_id, v_id, left(v_t.bar_name, 60), public.olnu_next_expiry(), v_t.n)
  on conflict (group_id, bar_id, night) do update set n = greatest(public.bar_takeovers.n, excluded.n)
  returning (xmax = 0)::int into v_new;
  return jsonb_build_object('ok', true, 'is_new', coalesce(v_new, 0) = 1);
end;
$$;

-- set_beer_type(p_type) -> jsonb {ok, type, n}
-- Sets the type of the caller's latest beer tonight (beer number n = beer_count of tonight's row).
-- Types: lager pilsner ipa apa stout vete ale sour alkfri annan (else invalid_type).
-- No beer tonight -> no_beer. Changing it again is fine (upsert). Works in ghost mode too.
create or replace function public.set_beer_type(p_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_t   text := lower(btrim(coalesce(p_type, '')));
  v_b   public.beers%rowtype;
begin
  if v_t not in ('lager', 'pilsner', 'ipa', 'apa', 'stout', 'vete', 'ale', 'sour', 'alkfri', 'annan') then
    raise exception 'invalid_type';
  end if;
  select * into v_b from public.beers b where b.user_id = v_uid and b.expires_at > now() and b.beer_count >= 1;
  if not found then raise exception 'no_beer'; end if;
  insert into public.beer_types as bt (user_id, night, n, type, lat, lng, created_at, updated_at)
  values (v_uid, v_b.expires_at, v_b.beer_count, v_t,
          round(v_b.lat::numeric, 2)::float8, round(v_b.lng::numeric, 2)::float8, now(), now())
  on conflict (user_id, night, n) do update set type = excluded.type, updated_at = now();
  return jsonb_build_object('ok', true, 'type', v_t, 'n', v_b.beer_count);
end;
$$;

-- beer_type_stats(p_lat, p_lng) -> setof (scope, period, type, n)
-- scope: 'sweden' | 'town' (within 20 km of p_lat/p_lng; only when both are given and inside Sweden).
-- period: 'night' (tonight) | 'week' (Monday 00:00 Europe/Stockholm -> now). Anonymous counts only.
create or replace function public.beer_type_stats(p_lat float8 default null, p_lng float8 default null)
returns table (scope text, period text, type text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_next_expiry();
  v_week  timestamptz := (public.olnu_week_start(now())::timestamp) at time zone 'Europe/Stockholm';
  v_town  boolean := public.olnu_bp_in_sweden(p_lat, p_lng);
begin
  return query
  with w as (
    select bt.type as ty, bt.night as nt, bt.created_at as ca, bt.lat as la, bt.lng as ln
      from public.beer_types bt
     where bt.created_at >= least(v_week, v_night - interval '24 hours')
  )
  select 'sweden'::text, 'night'::text, w.ty, count(*)::int from w where w.nt = v_night group by w.ty
  union all
  select 'sweden', 'week', w.ty, count(*)::int from w
   where w.ca >= v_week group by w.ty
  union all
  select 'town', 'night', w.ty, count(*)::int from w
   where v_town and w.nt = v_night and w.la is not null
     and abs(w.la - p_lat) < 0.2 and abs(w.ln - p_lng) < 0.4
     and public.olnu_dist_m(w.la, w.ln, p_lat, p_lng) <= 20000
   group by w.ty
  union all
  select 'town', 'week', w.ty, count(*)::int from w
   where v_town and w.ca >= v_week and w.la is not null
     and abs(w.la - p_lat) < 0.2 and abs(w.ln - p_lng) < 0.4
     and public.olnu_dist_m(w.la, w.ln, p_lat, p_lng) <= 20000
   group by w.ty;
end;
$$;

-- my_group_flags() -> setof (group_id, show_on_map, can_edit) for all the caller's groups.
create or replace function public.my_group_flags()
returns table (group_id uuid, show_on_map bool, can_edit bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select m.group_id, coalesce(f.show_on_map, false), public.olnu_group_admin(m.group_id, v_uid)
    from public.group_members m
    left join public.group_flags f on f.group_id = m.group_id
   where m.user_id = v_uid
   order by m.joined_at;
end;
$$;

-- set_group_show(p_group_id, p_on) -> jsonb {show_on_map}
-- "Visa vår grupp på kartan". Only the group creator (or the oldest member when the creator left).
-- Errors: not_member, not_admin.
create or replace function public.set_group_show(p_group_id uuid, p_on bool)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if not public.olnu_group_admin(p_group_id, v_uid) then raise exception 'not_admin'; end if;
  insert into public.group_flags as f (group_id, show_on_map, updated_at, updated_by)
  values (p_group_id, coalesce(p_on, false), now(), v_uid)
  on conflict (group_id) do update set show_on_map = excluded.show_on_map, updated_at = now(), updated_by = v_uid;
  return jsonb_build_object('show_on_map', coalesce(p_on, false));
end;
$$;

-- send_tip(p_group_id, p_bar_id, p_bar_name, p_body default null) -> jsonb {ok, wait_seconds, id, msg_id}
-- Posts "📣 <name> tipsar: Kom till <bar>! <body>" in the group chat. Caller must be a member (not_member).
-- Bar: invalid_bar. Body: optional, cleaned, max 40 chars, no links/phone numbers/bad words (invalid_msg).
-- 1 tip per 5 min per user (all groups): ok=false + wait_seconds. After ok: notify-group {event:"tip", tip_id}.
create or replace function public.send_tip(p_group_id uuid, p_bar_id text, p_bar_name text, p_body text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_bar  text := public.olnu_bp_clean(p_bar_name);
  v_body text := nullif(public.olnu_bp_clean(p_body), '');
  v_name text;
  v_last timestamptz;
  v_msg  text;
  v_mid  bigint;
  v_tid  bigint;
begin
  select m.display_name into v_name from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid;
  if not found then raise exception 'not_member'; end if;
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_bar) < 1 or char_length(v_bar) > 60 then
    raise exception 'invalid_bar';
  end if;
  if v_body is not null and (char_length(v_body) > 40 or public.olnu_bp_blocked(v_body)) then
    raise exception 'invalid_msg';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_tip:' || v_uid::text, 0));
  select max(t.created_at) into v_last from public.bar_tips t
   where t.user_id = v_uid and t.created_at > now() - interval '5 minutes';
  if v_last is not null then
    return jsonb_build_object('ok', false, 'id', null, 'msg_id', null,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + interval '5 minutes' - now())))::int));
  end if;

  v_msg := left('📣 ' || coalesce(v_name, 'Någon') || ' tipsar: Kom till ' || v_bar || '!' ||
                coalesce(' ' || v_body, ''), 140);
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_msg, public.olnu_next_expiry())
  returning id into v_mid;
  insert into public.bar_tips (user_id, group_id, bar_id, bar_name, body, msg_id)
  values (v_uid, p_group_id, v_id, v_bar, v_body, v_mid)
  returning id into v_tid;
  return jsonb_build_object('ok', true, 'wait_seconds', 0, 'id', v_tid, 'msg_id', v_mid);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Medals (ids are stable; names and texts live in docs/js/medals.js)
--    kospanare  Köspanaren         5 queue reports
--    (no medal for offers on purpose: Alkohollagen 7 kap. -- offers stay passive and user-written)
--    sommelier  Ölsommelieren      5 different beer types (not "annan")
--    erovrare   Erövraren          your group took over a bar (stacks per bar and night, after you joined)
--    tipsare    Kunskapsspridaren  3 bar tips sent
-- ---------------------------------------------------------------------------
create or replace function public.olnu_medal_eval_bars(p_uid uuid)
returns table (medal text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q int := 0; v_s int := 0; v_e int := 0; v_t int := 0;
begin
  begin
    select count(*) into v_q from public.bar_queue q where q.user_id = p_uid;
    select count(distinct bt.type) into v_s from public.beer_types bt where bt.user_id = p_uid and bt.type <> 'annan';
    select count(*) into v_e from public.bar_takeovers t
      join public.group_members m on m.group_id = t.group_id and m.user_id = p_uid
     where t.created_at >= m.joined_at;
    select count(*) into v_t from public.bar_tips t where t.user_id = p_uid;
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('kospanare', case when v_q >= 5 then 1 else 0 end),
    ('sommelier', case when v_s >= 5 then 1 else 0 end),
    ('erovrare', v_e),
    ('tipsare', case when v_t >= 3 then 1 else 0 end)
  ) as v(medal, n);
end;
$$;

-- Same name and return type as 0012; now also stores the v12 medals. Counts never go down.
create or replace function public.olnu_medal_store(p_uid uuid)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with ev as (
    select x.medal as m, x.n from public.olnu_medal_eval(p_uid) x
    union all
    select y.medal, y.n from public.olnu_medal_eval_bars(p_uid) y
  ),
  e as (
    select ev.m, max(ev.n)::int as n from ev where ev.n >= 1 group by ev.m
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

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  fns text[] := array[
    'public.report_queue(text, text, double precision, double precision, double precision, double precision, text, text)',
    'public.add_offer(text, text, double precision, double precision, double precision, double precision, text)',
    'public.vote_offer(bigint, integer)',
    'public.bar_status()',
    'public.note_takeover(text)',
    'public.set_beer_type(text)',
    'public.beer_type_stats(double precision, double precision)',
    'public.my_group_flags()',
    'public.set_group_show(uuid, boolean)',
    'public.send_tip(uuid, text, text, text)'
  ];
  internal text[] := array[
    'public.olnu_bp_clean(text)',
    'public.olnu_bp_in_sweden(double precision, double precision)',
    'public.olnu_bp_check(text, text, double precision, double precision, double precision, double precision)',
    'public.olnu_bp_blocked(text)',
    'public.olnu_takeovers()',
    'public.olnu_group_admin(uuid, uuid)',
    'public.olnu_bar_queue_now(text)',
    'public.olnu_medal_eval_bars(uuid)',
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

-- ===== supabase/migrations/0015_privacy_poll.sql =====
-- Öl Nu v13: PRIVACY & POLL (server). Additive. Safe to run again.
-- Binding spec: CONTRACT.md, section "v13 PRIVACY & POLL (server)".
--  1. Strangers never see an exact position. Group-mates and the caller see the exact pin. A stranger's
--     precise pin is moved to the bar point (bar within 75 m, table bars_lite) or to the ~550 m grid point.
--     This also applies to the old live_beers() (same columns, same types; only the values change).
--  2. Strangers get a short-lived opaque pin id in poll_v2 (changes every 10 min), so nobody can follow
--     one person all night. skal_v2 / react_v2 take that id (or a friend's numeric id).
--  3. post_beer_v2(..., p_hidden): Spökläge on the server. The beer counts, the pin stays hidden and no
--     heat point is written.
--  4. poll_v2(): one call per poll, only the map view (+ margin), capped at 1500 stranger pins.
--  5. undo_beer(): take back the latest beer within 2 minutes, max 3 per night.
--  6. Heat: precise beers snap to the bar point (75 m) or a ~55 m cell (a cell with < 3 beers -> ~550 m
--     grid); undone beers are left out.
-- Old rows are never removed: every read filters on time or on a flag. This file has no remove-type
-- statements on purpose (create-or-replace, "if not exists", "on conflict" and UPDATE only).
-- Needs 0001-0013 first (0014 is optional). Postgres 14+.

-- ---------------------------------------------------------------------------
-- 1. Tables and columns (RLS on, no policies; only SECURITY DEFINER functions and the service role)
-- ---------------------------------------------------------------------------

-- Bars the server can snap strangers to (copy of docs/bars.json + bars-extra.json; closed bars active=false).
create table if not exists public.bars_lite (
  id         text primary key check (char_length(id) between 1 and 80),
  name       text,
  lat        float8 not null,
  lng        float8 not null,
  type       text,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists bars_lite_lat_lng_idx on public.bars_lite (lat, lng) where active;

-- One server secret for the opaque stranger pin ids. Never leaves the database.
create table if not exists public.olnu_secrets (
  id     int primary key check (id = 1),
  secret text not null
);
insert into public.olnu_secrets (id, secret)
values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

-- beers: state before the latest beer (for undo_beer), undo counter, ghost flag.
alter table public.beers add column if not exists prev_lat     float8;
alter table public.beers add column if not exists prev_lng     float8;
alter table public.beers add column if not exists prev_precise boolean;
alter table public.beers add column if not exists prev_stopped boolean;
alter table public.beers add column if not exists prev_ghost   boolean;
alter table public.beers add column if not exists prev_beer_at timestamptz;
alter table public.beers add column if not exists prev_for     int;      -- beer_count the prev_* values belong to
alter table public.beers add column if not exists undo_count   int not null default 0;
alter table public.beers add column if not exists ghost        boolean not null default false;
-- beers: the position strangers see, set by trigger olnu_beer_snap when the pin moves:
-- precise pin within 75 m of an active bar -> bar point + snap_bar; other precise pin -> ~550 m grid point;
-- "Bara område" pin -> its own (already grid) position.
alter table public.beers add column if not exists snap_lat     float8;
alter table public.beers add column if not exists snap_lng     float8;
alter table public.beers add column if not exists snap_bar     text;

-- beer_events: undone beers stay as rows but are never shown. hlat/hlng = the heat cell, set by trigger
-- olnu_event_cell on insert: precise beer within 75 m of an active bar -> bar point, other precise beer ->
-- ~55 m cell (0.0005 x 0.001 deg), "Bara område" beer -> its own ~550 m grid point. A ~55 m cell with
-- fewer than 3 beers tonight is shown on the ~550 m grid instead (one beer at home is not a dot on the house).
alter table public.beer_events add column if not exists undone boolean not null default false;
alter table public.beer_events add column if not exists hlat   float8;
alter table public.beer_events add column if not exists hlng   float8;
alter table public.beer_events add column if not exists hkind  smallint;  -- 1 bar, 2 ~55 m cell, 3 ~550 m grid

-- Map-box filters: beers use beers_lat_lng_idx (0006) + beers_expires_at_idx (0001) as a bitmap AND.
-- Heat cells in a box (tonight's rows):
create index if not exists beer_events_heat_idx on public.beer_events (expires_at, hlat, hlng) where kind = 'beer';

alter table public.bars_lite    enable row level security;
alter table public.olnu_secrets enable row level security;
revoke all on table public.bars_lite, public.olnu_secrets from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.bars_lite, public.olnu_secrets from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.bars_lite, public.olnu_secrets from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.bars_lite to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------------

-- Before each update of a beers row: keep the state from before the latest beer (for undo_beer),
-- and clear the ghost flag when the pin becomes visible again. Catches its own errors.
create or replace function public.olnu_beer_prev_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if coalesce(new.beer_count, 0) > coalesce(old.beer_count, 0) then
      new.prev_lat     := old.lat;
      new.prev_lng     := old.lng;
      new.prev_precise := old.precise;
      new.prev_stopped := old.stopped;
      new.prev_ghost   := old.ghost;
      new.prev_beer_at := old.beer_at;
      new.prev_for     := new.beer_count;
    end if;
    if not new.stopped then
      new.ghost := false;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_beer_prev
  before update on public.beers
  for each row execute function public.olnu_beer_prev_tg();

-- Heat events (0005/0007): same as before, but a ghost beer (post_beer_v2 with p_hidden) writes nothing.
-- post_beer_v2 sets the transaction-local setting olnu.ghost = '1' around its post_beer call.
create or replace function public.olnu_log_beer_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_beers int := 0;
  v_old_shots int := 0;
begin
  if coalesce(current_setting('olnu.ghost', true), '') = '1' then
    return new;
  end if;
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

-- Nearest active bar within 75 m of (p_lat, p_lng), or no row.
create or replace function public.olnu_near_bar(p_lat float8, p_lng float8)
returns table (id text, lat float8, lng float8)
language sql
stable
set search_path = public
as $$
  select bl.id, bl.lat, bl.lng
    from public.bars_lite bl
   where bl.active
     and bl.lat between p_lat - 0.0007 and p_lat + 0.0007
     and bl.lng between p_lng - 0.0019 and p_lng + 0.0019
     and power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2) <= 5625
   order by power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2), bl.id
   limit 1;
$$;

-- Stranger view of one pin position: (snap_lat, snap_lng, snap_bar).
create or replace function public.olnu_snap(p_lat float8, p_lng float8, p_precise boolean)
returns table (snap_lat float8, snap_lng float8, snap_bar text)
language plpgsql
stable
set search_path = public
as $$
declare
  v_id text; v_la float8; v_ln float8;
begin
  if p_lat is null or p_lng is null then
    return query select p_lat, p_lng, null::text;
    return;
  end if;
  if coalesce(p_precise, false) then
    select nb.id, nb.lat, nb.lng into v_id, v_la, v_ln from public.olnu_near_bar(p_lat, p_lng) nb;
    if v_id is not null then
      return query select v_la, v_ln, v_id;
      return;
    end if;
    return query select (round(p_lat::numeric / 0.005) * 0.005)::float8, (round(p_lng::numeric / 0.01) * 0.01)::float8, null::text;
    return;
  end if;
  return query select p_lat, p_lng, null::text;
end;
$$;

-- Heat cell of one beer event: (hlat, hlng, hkind) with hkind 1 = bar point, 2 = ~55 m cell, 3 = ~550 m grid.
create or replace function public.olnu_heat_cell(p_lat float8, p_lng float8, p_precise boolean)
returns table (hlat float8, hlng float8, hkind smallint)
language plpgsql
stable
set search_path = public
as $$
declare
  v_la float8; v_ln float8;
begin
  if p_lat is null or p_lng is null or not coalesce(p_precise, false) then
    return query select p_lat, p_lng, 3::smallint;
    return;
  end if;
  select nb.lat, nb.lng into v_la, v_ln from public.olnu_near_bar(p_lat, p_lng) nb;
  if v_la is not null then
    return query select v_la, v_ln, 1::smallint;
    return;
  end if;
  return query select (round(p_lat::numeric / 0.0005) * 0.0005)::float8, (round(p_lng::numeric / 0.001) * 0.001)::float8, 2::smallint;
end;
$$;

-- beers: keep snap_* in step with the pin. Catches its own errors (falls back to the grid point).
create or replace function public.olnu_beer_snap_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    select s.snap_lat, s.snap_lng, s.snap_bar into new.snap_lat, new.snap_lng, new.snap_bar
      from public.olnu_snap(new.lat, new.lng, new.precise) s;
  exception when others then
    new.snap_lat := (round(new.lat::numeric / 0.005) * 0.005)::float8;
    new.snap_lng := (round(new.lng::numeric / 0.01) * 0.01)::float8;
    new.snap_bar := null;
  end;
  return new;
end; $$;

create or replace trigger olnu_beer_snap
  before insert or update of lat, lng, precise on public.beers
  for each row execute function public.olnu_beer_snap_tg();

-- beer_events: heat cell on insert. Catches its own errors (falls back to the ~550 m grid).
create or replace function public.olnu_event_cell_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    select c.hlat, c.hlng, c.hkind into new.hlat, new.hlng, new.hkind
      from public.olnu_heat_cell(new.lat, new.lng, new.precise) c;
  exception when others then
    new.hlat := (round(new.lat::numeric / 0.005) * 0.005)::float8;
    new.hlng := (round(new.lng::numeric / 0.01) * 0.01)::float8;
    new.hkind := 3;
  end;
  return new;
end; $$;

create or replace trigger olnu_event_cell
  before insert on public.beer_events
  for each row execute function public.olnu_event_cell_tg();

-- Recompute snap_* / hlat-hlng for recent rows (run after the migration and after each bars_lite import:
-- select public.olnu_resnap();). Returns the number of beers rows touched.
create or replace function public.olnu_resnap()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.beers b
     set (snap_lat, snap_lng, snap_bar) = (select s.snap_lat, s.snap_lng, s.snap_bar
                                             from public.olnu_snap(b.lat, b.lng, b.precise) s)
   where b.expires_at > now() - interval '1 day' or b.snap_lat is null;
  get diagnostics v_n = row_count;
  update public.beer_events e
     set (hlat, hlng, hkind) = (select c.hlat, c.hlng, c.hkind from public.olnu_heat_cell(e.lat, e.lng, e.precise) c)
   where e.expires_at > now() - interval '1 day' or e.hlat is null or e.hkind is null;
  -- (beer_events older than ~10 days are cleaned by the notify-group function, so this stays small.)
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

-- Opaque stranger pin id (inlined below for speed):
--   'p' || left(md5(secret || ':' || beer_id || ':' || bucket), 15), bucket = floor(epoch / 600) (10 min).

-- Visible live pins for p_uid with the privacy rules applied.
-- Box (all four non-null) = only pins whose SHOWN position is inside the box, plus the caller and
-- group-mates anywhere. Null box = all of Sweden.
--   caller / group-mates: exact lat/lng, snap 'exact' (precise) or 'area', stable numeric id.
--   strangers: bar point (precise pin within 75 m of an active bars_lite row, snap 'bar'),
--              else the ~550 m grid point (snap 'area'); created_at floored to 15 min; opaque id.
--   bar_id: nearest active bar within 75 m of a precise pin (for everyone; null for area pins).
create or replace function public.olnu_pins(p_uid uuid, p_min_lat float8, p_min_lng float8,
                                            p_max_lat float8, p_max_lng float8)
returns table (beer_id bigint, pin_id text, lat float8, lng float8, snap text, bar_id text,
               precise bool, beer_count int, other_count int, other_kind text,
               created_at timestamptz, is_mine bool, is_friend bool, friend_name text)
language plpgsql
stable
set search_path = public
as $$
declare
  v_box    boolean := p_min_lat is not null and p_min_lng is not null and p_max_lat is not null and p_max_lng is not null;
  v_secret text := (select s.secret from public.olnu_secrets s where s.id = 1);
  v_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
  -- Raw-position prefilter: the box grown by the largest snap distance (grid half-cell, > 75 m).
  v_a float8 := p_min_lat - 0.0035;  v_c float8 := p_max_lat + 0.0035;
  v_b float8 := p_min_lng - 0.0070;  v_d float8 := p_max_lng + 0.0070;
begin
  return query
  with mates as (
    select am.user_id as uid, min(am.display_name) as fname
      from public.group_members cm
      join public.group_members am on am.group_id = cm.group_id
     where cm.user_id = p_uid and am.user_id <> p_uid
     group by am.user_id
  ),
  me_and_mates as (
    select m.uid, m.fname from mates m
    union all
    select p_uid, null::text
  ),
  cand as (
    -- 1. everything in the (grown) box, or everything when there is no box
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, mm.uid is not null as known, mm.fname
      from public.beers b
      left join me_and_mates mm on mm.uid = b.user_id
     where b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and (not v_box or (b.lat between v_a and v_c and b.lng between v_b and v_d))
    union all
    -- 2. the caller and group-mates outside the grown box
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, true, mm.fname
      from me_and_mates mm
      join public.beers b on b.user_id = mm.uid
     where v_box and b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and not (b.lat between v_a and v_c and b.lng between v_b and v_d)
  )
  select c.id,
         case when c.known then c.id::text
              else 'p' || left(md5(v_secret || ':' || c.id::text || ':' || v_bucket::text), 15) end,
         case when c.known then c.lat else coalesce(c.snap_lat, (round(c.lat::numeric / 0.005) * 0.005)::float8) end,
         case when c.known then c.lng else coalesce(c.snap_lng, (round(c.lng::numeric / 0.01) * 0.01)::float8) end,
         case when c.known then (case when c.precise then 'exact' else 'area' end)
              when c.snap_bar is not null then 'bar' else 'area' end,
         c.snap_bar,
         case when c.known then c.precise else c.snap_bar is not null end,
         c.beer_count, coalesce(c.other_count, 0), c.other_kind,
         case when c.known then c.created_at
              else to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900) end,
         c.user_id = p_uid, c.known and c.user_id <> p_uid, c.fname
    from cand c
   where c.known or not v_box
      or (coalesce(c.snap_lat, c.lat) between p_min_lat and p_max_lat
          and coalesce(c.snap_lng, c.lng) between p_min_lng and p_max_lng);
end;
$$;

-- Beer id for a pin id from poll_v2: a numeric id is accepted only for the caller's own pin or a
-- group-mate's pin; an opaque id is accepted for the current or the previous 10-minute bucket.
-- Null when nothing live matches.
create or replace function public.olnu_resolve_pin(p_uid uuid, p_pin text)
returns bigint
language plpgsql
stable
set search_path = public
as $$
declare
  v_pin    text := btrim(coalesce(p_pin, ''));
  v_secret text := (select s.secret from public.olnu_secrets s where s.id = 1);
  v_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_id     bigint;
begin
  if v_pin ~ '^[0-9]{1,18}$' then
    select b.id into v_id
      from public.beers b
     where b.id = v_pin::bigint and b.expires_at > now() and not b.stopped
       and (b.user_id = p_uid
            or exists (select 1 from public.group_members am
                         join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid
                        where am.user_id = b.user_id));
    return v_id;
  end if;
  if v_pin !~ '^p[0-9a-f]{15}$' then
    return null;
  end if;
  select b.id into v_id
    from public.beers b
   where b.expires_at > now() and not b.stopped
     and ('p' || left(md5(v_secret || ':' || b.id::text || ':' || v_bucket::text), 15) = v_pin
          or 'p' || left(md5(v_secret || ':' || b.id::text || ':' || (v_bucket - 1)::text), 15) = v_pin)
   limit 1;
  return v_id;
end;
$$;

-- Heat cells for tonight (beer_events.hlat/hlng/hkind, see trigger olnu_event_cell). Undone beers are
-- left out. A ~55 m cell with fewer than 3 beers is shown on the ~550 m grid.
-- Box (all four non-null) = only cells inside the box. Weight per beer: 1, 2 (beer 5-9), 3 (10+).
create or replace function public.olnu_heat(p_min_lat float8, p_min_lng float8, p_max_lat float8,
                                            p_max_lng float8, p_limit int)
returns table (lat float8, lng float8, w float8)
language plpgsql
stable
set search_path = public
as $$
declare
  v_box boolean := p_min_lat is not null and p_min_lng is not null and p_max_lat is not null and p_max_lng is not null;
begin
  return query
  with cells as (
    select e.hlat as clat, e.hlng as clng, e.hkind as k, count(*) as cn,
           sum(case when e.n >= 10 then 3 when e.n >= 5 then 2 else 1 end)::float8 as cw
      from public.beer_events e
     where e.expires_at > now() and e.kind = 'beer' and not e.undone and e.hlat is not null
       and (not v_box or (e.hlat between p_min_lat - 0.0025 and p_max_lat + 0.0025
                          and e.hlng between p_min_lng - 0.005 and p_max_lng + 0.005))
     group by e.hlat, e.hlng, e.hkind
  ),
  shown as (
    -- k-anonymity: a ~55 m cell with fewer than 3 beers moves to its ~550 m grid point.
    select case when c.k = 2 and c.cn < 3 then round(c.clat * 200) / 200.0 else c.clat end as slat,
           case when c.k = 2 and c.cn < 3 then round(c.clng * 100) / 100.0 else c.clng end as slng,
           c.cw
      from cells c
  )
  select s.slat, s.slng, sum(s.cw)::float8 as sw
    from shown s
   where not v_box or (s.slat between p_min_lat and p_max_lat and s.slng between p_min_lng and p_max_lng)
   group by s.slat, s.slng
   order by sw desc, s.slat, s.slng
   limit greatest(1, least(coalesce(p_limit, 5000), 5000));
end;
$$;

revoke all on function public.olnu_beer_prev_tg(), public.olnu_beer_snap_tg(), public.olnu_event_cell_tg(),
  public.olnu_near_bar(float8, float8), public.olnu_snap(float8, float8, boolean),
  public.olnu_heat_cell(float8, float8, boolean), public.olnu_resnap(), public.olnu_pins(uuid, float8, float8, float8, float8),
  public.olnu_resolve_pin(uuid, text), public.olnu_heat(float8, float8, float8, float8, int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_beer_prev_tg(), public.olnu_beer_snap_tg(), public.olnu_event_cell_tg(), public.olnu_near_bar(float8, float8), public.olnu_snap(float8, float8, boolean), public.olnu_heat_cell(float8, float8, boolean), public.olnu_resnap(), public.olnu_pins(uuid, float8, float8, float8, float8), public.olnu_resolve_pin(uuid, text), public.olnu_heat(float8, float8, float8, float8, int) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_beer_prev_tg(), public.olnu_beer_snap_tg(), public.olnu_event_cell_tg(), public.olnu_near_bar(float8, float8), public.olnu_snap(float8, float8, boolean), public.olnu_heat_cell(float8, float8, boolean), public.olnu_resnap(), public.olnu_pins(uuid, float8, float8, float8, float8), public.olnu_resolve_pin(uuid, text), public.olnu_heat(float8, float8, float8, float8, int) from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Old RPCs: same names, parameters and return types; privacy rules applied
-- ---------------------------------------------------------------------------

-- live_beers(): strangers now get the bar point or the grid point (precise = true only at a bar) and a
-- created_at floored to 15 min. Ids stay numeric and stable (old apps need them for skal/react).
-- Ghost pins (stopped) are hidden as before.
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
  with p as (
    select * from public.olnu_pins(v_uid, null, null, null, null)
  ),
  sk as (
    select s.beer_id as sid, count(*)::int as n, bool_or(s.user_id = v_uid) as mine
      from public.skals s join p on p.beer_id = s.beer_id
     group by s.beer_id
  )
  select p.beer_id, p.lat, p.lng, p.beer_count, p.precise, p.created_at, p.is_mine,
         case when p.is_mine then null else p.friend_name end,
         coalesce(sk.n, 0), coalesce(sk.mine, false)
    from p left join sk on sk.sid = p.beer_id
   order by p.created_at, p.beer_id;
end;
$$;

-- heat_points(): same columns; now built by olnu_heat (bar point / ~55 m cells, no undone beers).
create or replace function public.heat_points()
returns table (lat float8, lng float8, w float8)
language plpgsql security definer set search_path = public stable as $$
begin
  perform public.olnu_uid();
  return query select h.lat, h.lng, h.w from public.olnu_heat(null, null, null, null, 5000) h;
end; $$;

-- ghost_points(): same columns as 0007 (anonymous beers 1-8 days ago, w = number of beers), now with
-- the heat cells (bar point / ~55 m cell / ~550 m grid), a ~55 m cell with fewer than 3 beers on the
-- ~550 m grid, and undone beers left out.
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
  with cells as (
    select e.hlat as clat, e.hlng as clng, e.hkind as k, count(*) as cn
      from public.beer_events e
     where e.kind = 'beer'
       and not e.undone
       and e.hlat is not null
       and e.created_at >= now() - interval '8 days'
       and e.created_at <  now() - interval '1 day'
     group by e.hlat, e.hlng, e.hkind
  )
  select x.slat, x.slng, sum(x.cn)::float8 as cw
    from (select case when c.k = 2 and c.cn < 3 then round(c.clat * 200) / 200.0 else c.clat end as slat,
                 case when c.k = 2 and c.cn < 3 then round(c.clng * 100) / 100.0 else c.clng end as slng,
                 c.cn
            from cells c) x
   group by x.slat, x.slng
   order by cw desc
   limit 5000;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. New RPCs
-- ---------------------------------------------------------------------------

-- post_beer_v2(p_lat, p_lng, p_precise, p_hidden default false) -> jsonb
--   {accepted, wait_seconds, id, lat, lng, beer_count, is_new, expires_at, milestone,
--    hidden, undo_until, undos_left}
-- p_hidden = false: exactly post_beer. p_hidden = true (Spökläge): the beer counts (streak, week totals,
-- medals, titles) but the pin is hidden (stopped) at once, stored on the ~550 m grid only, and no heat
-- point is written. Errors: outside_sweden, not_authenticated.
create or replace function public.post_beer_v2(p_lat float8, p_lng float8, p_precise bool,
                                               p_hidden bool default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_hidden boolean := coalesce(p_hidden, false);
  v_r      jsonb;
  v_row    public.beers%rowtype;
begin
  if v_hidden then
    perform set_config('olnu.ghost', '1', true);
    v_r := public.post_beer(p_lat, p_lng, false)::jsonb;
    perform set_config('olnu.ghost', '', true);
    if (v_r->>'accepted')::boolean then
      update public.beers set stopped = true, ghost = true
       where id = (v_r->>'id')::bigint and user_id = v_uid;
      -- No beer_events row, so count the beer for the owner page here.
      begin
        insert into public.owner_hours as h (hour, beers) values (date_trunc('hour', now()), 1)
        on conflict (hour) do update set beers = h.beers + 1;
      exception when others then
        null;
      end;
    end if;
  else
    v_r := public.post_beer(p_lat, p_lng, p_precise)::jsonb;
  end if;

  select * into v_row from public.beers b where b.id = (v_r->>'id')::bigint;
  return v_r || jsonb_build_object(
    'hidden', coalesce(v_row.stopped, false),
    'undo_until', case when (v_r->>'accepted')::boolean then v_row.beer_at + interval '2 minutes' end,
    'undos_left', greatest(0, 3 - coalesce(v_row.undo_count, 0)));
end;
$$;

-- undo_beer() -> jsonb {ok, beer_count, reason, undos_left, lat, lng, hidden}
-- Takes back the caller's latest beer when it was accepted less than 2 minutes ago. Max 3 per night.
-- reason (ok = false): no_beer | too_late | limit. Nothing changes when ok = false.
-- Effects: beer_count - 1; beer_at back to the beer before (so the cooldown is the old one); position,
-- precision and visibility back to before that beer (only if no other drink moved the pin since);
-- tonight's first beer undone -> the pin is hidden (unless it has other drinks); its heat point is
-- flagged undone; week total, owner hour count, tonight's medal night count and a "Kung av baren" tap
-- recorded after the beer go down by 1. Earned medals are never taken back.
create or replace function public.undo_beer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_row  public.beers%rowtype;
  v_move boolean;
  v_n    int;
begin
  select * into v_row from public.beers b
   where b.user_id = v_uid and b.expires_at > now()
   for update;
  if not found or v_row.beer_count < 1 then
    return jsonb_build_object('ok', false, 'reason', 'no_beer', 'beer_count', coalesce(v_row.beer_count, 0),
                              'undos_left', greatest(0, 3 - coalesce(v_row.undo_count, 0)));
  end if;
  if v_row.undo_count >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'beer_count', v_row.beer_count, 'undos_left', 0);
  end if;
  if v_row.beer_at is null or v_row.beer_at <= now() - interval '2 minutes'
     or (v_row.prev_for is distinct from v_row.beer_count and v_row.beer_count <> 1) then
    return jsonb_build_object('ok', false, 'reason', 'too_late', 'beer_count', v_row.beer_count,
                              'undos_left', greatest(0, 3 - v_row.undo_count));
  end if;

  -- Heat point of this beer (same transaction time, number and night). Ghost beers have none.
  update public.beer_events e set undone = true
   where e.id = (select e2.id from public.beer_events e2
                  where e2.kind = 'beer' and e2.created_at = v_row.beer_at and e2.n = v_row.beer_count
                    and e2.expires_at = v_row.expires_at and not e2.undone
                  order by e2.id desc limit 1);
  update public.owner_hours h set beers = h.beers - 1
   where h.hour = date_trunc('hour', v_row.beer_at) and h.beers > 0;
  update public.week_beers w set n = w.n - 1
   where w.user_id = v_uid and w.week = public.olnu_week_start(v_row.beer_at) and w.n > 0;
  update public.medal_nights m set beers = least(m.beers, v_row.beer_count - 1)
   where m.user_id = v_uid and m.night = v_row.expires_at;
  update public.bar_taps t set n = t.n - 1
   where t.user_id = v_uid and t.week = public.olnu_week_start(v_row.beer_at)
     and t.last_at >= v_row.beer_at and t.n > 0;

  -- Did the pin stay where this beer put it? (another drink after the beer moves it)
  v_move := v_row.prev_for = v_row.beer_count and v_row.prev_lat is not null
            and (v_row.other_at is null or v_row.other_at <= v_row.beer_at);
  v_n := v_row.beer_count - 1;

  update public.beers b
     set beer_count = v_n,
         beer_at    = case when v_row.prev_for = v_row.beer_count then v_row.prev_beer_at else null end,
         lat        = case when v_move then v_row.prev_lat else b.lat end,
         lng        = case when v_move then v_row.prev_lng else b.lng end,
         precise    = case when v_move then coalesce(v_row.prev_precise, b.precise) else b.precise end,
         stopped    = case when v_n = 0 and coalesce(b.other_count, 0) = 0 then true
                           when v_row.prev_for = v_row.beer_count then coalesce(v_row.prev_stopped, b.stopped)
                           else b.stopped end,
         ghost      = case when v_row.prev_for = v_row.beer_count then coalesce(v_row.prev_ghost, false) else b.ghost end,
         updated_at = now(),
         undo_count = b.undo_count + 1,
         prev_lat = null, prev_lng = null, prev_precise = null, prev_stopped = null,
         prev_ghost = null, prev_beer_at = null, prev_for = null
   where b.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'reason', null, 'beer_count', v_row.beer_count,
                            'undos_left', greatest(0, 3 - v_row.undo_count),
                            'lat', v_row.lat, 'lng', v_row.lng, 'hidden', v_row.stopped);
end;
$$;

-- skal_v2(p_pin text) -> json {skal_count, already}. p_pin = the pin id from poll_v2 (numeric for the
-- caller / group-mates, opaque 'p...' for strangers, valid ~10-20 min). Errors: beer_not_found
-- (unknown, expired, hidden or rotated id), own_beer, not_authenticated.
create or replace function public.skal_v2(p_pin text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint := public.olnu_resolve_pin(v_uid, p_pin);
begin
  if v_id is null then
    raise exception 'beer_not_found';
  end if;
  return public.skal(v_id);
end;
$$;

-- react_v2(p_pin text, p_emoji text) -> json {counts, mine}. Same as react with a poll_v2 pin id.
-- Errors: invalid_emoji, beer_not_found, own_beer, not_authenticated.
create or replace function public.react_v2(p_pin text, p_emoji text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint;
begin
  if p_emoji is null or p_emoji not in ('🔥', '😂', '💀', '💪') then
    raise exception 'invalid_emoji';
  end if;
  v_id := public.olnu_resolve_pin(v_uid, p_pin);
  if v_id is null then
    raise exception 'beer_not_found';
  end if;
  return public.react(v_id, p_emoji);
end;
$$;

-- poll_v2(box, p_since default null, p_heat default false) -> json, everything one poll needs.
-- See CONTRACT.md v13 for the full shape. p_since is accepted for later use; this version always
-- answers the full view ("full": true).
create or replace function public.poll_v2(p_min_lat float8, p_min_lng float8, p_max_lat float8, p_max_lng float8,
                                          p_since timestamptz default null, p_heat bool default false)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.olnu_uid();
  v_cap     constant int := 1500;
  v_a       float8; v_b float8; v_c float8; v_d float8;   -- min lat, min lng, max lat, max lng (+ margin)
  v_clat    float8; v_clng float8; v_cos float8;
  v_mlat    float8; v_mlng float8;
  v_pins    json;
  v_n_str   int;
  v_me      jsonb;
  v_row     public.beers%rowtype;
  v_out     json;
  v_bucket  bigint := floor(extract(epoch from now()) / 600)::bigint;
begin
  if p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
     or 'NaN'::float8 in (p_min_lat, p_min_lng, p_max_lat, p_max_lng)
     or abs(p_min_lat) = 'Infinity'::float8 or abs(p_max_lat) = 'Infinity'::float8
     or abs(p_min_lng) = 'Infinity'::float8 or abs(p_max_lng) = 'Infinity'::float8 then
    raise exception 'invalid_bbox';
  end if;
  v_a := least(p_min_lat, p_max_lat);  v_c := greatest(p_min_lat, p_max_lat);
  v_b := least(p_min_lng, p_max_lng);  v_d := greatest(p_min_lng, p_max_lng);
  -- 15 % margin on each side (at least ~550 m), then clamp to the Sweden bbox.
  v_mlat := greatest((v_c - v_a) * 0.15, 0.005);
  v_mlng := greatest((v_d - v_b) * 0.15, 0.01);
  v_a := greatest(55.0, v_a - v_mlat);  v_c := least(69.1, v_c + v_mlat);
  v_b := greatest(10.9, v_b - v_mlng);  v_d := least(24.2, v_d + v_mlng);
  if v_a > v_c or v_b > v_d then
    -- Box outside Sweden: only the caller and group-mates.
    v_a := 0; v_c := 0; v_b := 0; v_d := 0;
  end if;
  v_clat := (v_a + v_c) / 2;  v_clng := (v_b + v_d) / 2;  v_cos := cos(radians(v_clat));

  with p as (
    select * from public.olnu_pins(v_uid, v_a, v_b, v_c, v_d)
  ),
  ranked as (
    select p.*,
           row_number() over (partition by (p.is_mine or p.is_friend)
                              order by power(p.lat - v_clat, 2) + power((p.lng - v_clng) * v_cos, 2), p.pin_id) as rn,
           count(*) filter (where not (p.is_mine or p.is_friend)) over () as nstr
      from p
  ),
  sel as (
    select * from ranked r where r.is_mine or r.is_friend or r.rn <= v_cap
  ),
  sk as (
    select s.beer_id as sid, count(*)::int as n, bool_or(s.user_id = v_uid) as mine
      from public.skals s join sel on sel.beer_id = s.beer_id
     group by s.beer_id
  ),
  rx1 as (
    select r.beer_id as rid, r.emoji, count(*)::int as n, bool_or(r.user_id = v_uid) as mine
      from public.reactions r join sel on sel.beer_id = r.beer_id
     where r.active
     group by r.beer_id, r.emoji
  ),
  rx as (
    select rx1.rid, jsonb_object_agg(rx1.emoji, rx1.n) as counts,
           coalesce(jsonb_agg(rx1.emoji order by rx1.emoji) filter (where rx1.mine), '[]'::jsonb) as mine
      from rx1 group by rx1.rid
  )
  -- Compact rows: null, false, 0 and empty values are left out (clients treat a missing field as empty).
  select coalesce(json_agg(json_strip_nulls(json_build_object(
           'id',          case when sel.is_mine or sel.is_friend then to_json(sel.beer_id) else to_json(sel.pin_id) end,
           'lat',         sel.lat,
           'lng',         sel.lng,
           'snap',        sel.snap,
           'bar_id',      sel.bar_id,
           'precise',     sel.precise,
           'beer_count',  sel.beer_count,
           'other_count', nullif(sel.other_count, 0),
           'other_kind',  case when sel.other_count > 0 then sel.other_kind end,
           'created_at',  sel.created_at,
           'is_mine',     case when sel.is_mine then true end,
           'is_friend',   case when sel.is_friend then true end,
           'friend_name', case when sel.is_mine then null else sel.friend_name end,
           'skal_count',  sk.n,
           'i_skaled',    case when sk.mine then true end,
           'rx',          rx.counts,
           'my_rx',       case when rx.mine <> '[]'::jsonb then rx.mine end,
           'total',       case when sel.is_mine or sel.is_friend then public.olnu_lifetime(
                            (select b.user_id from public.beers b where b.id = sel.beer_id)) end
         )) order by sel.created_at, sel.pin_id), '[]'::json),
         coalesce(max(sel.nstr), 0)
    into v_pins, v_n_str
    from sel
    left join sk on sk.sid = sel.beer_id
    left join rx on rx.rid = sel.beer_id;

  select * into v_row from public.beers b where b.user_id = v_uid and b.expires_at > now();
  v_me := public.my_stats()::jsonb || jsonb_build_object(
    'id',           v_row.id,
    'beer_count',   coalesce(v_row.beer_count, 0),
    'other_count',  coalesce(v_row.other_count, 0),
    'other_kind',   v_row.other_kind,
    'lat',          v_row.lat,
    'lng',          v_row.lng,
    'precise',      v_row.precise,
    'hidden',       coalesce(v_row.stopped, false),
    'ghost',        coalesce(v_row.ghost, false),
    'expires_at',   v_row.expires_at,
    'beer_at',      v_row.beer_at,
    'wait_seconds', case when v_row.beer_count > 0 and v_row.beer_at > now() - interval '10 minutes'
                         then greatest(1, ceil(extract(epoch from (v_row.beer_at + interval '10 minutes' - now())))::int)
                         else 0 end,
    'undo_until',   case when v_row.beer_count > 0 and coalesce(v_row.undo_count, 0) < 3
                          and v_row.beer_at > now() - interval '2 minutes'
                          and (v_row.prev_for = v_row.beer_count or v_row.beer_count = 1)
                         then v_row.beer_at + interval '2 minutes' end,
    'undos_left',   greatest(0, 3 - coalesce(v_row.undo_count, 0)));

  v_out := json_build_object(
    'v',            1,
    'server_time',  now(),
    'full',         true,
    'ids_until',    to_timestamp((v_bucket + 1) * 600),
    'bbox',         json_build_array(v_a, v_b, v_c, v_d),
    'pins',         v_pins,
    'capped',       v_n_str > v_cap,
    'pins_in_view', v_n_str,
    'live_total',   (select count(*)::int from public.beers b
                      where b.expires_at > now() and not b.stopped
                        and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)),
    'me',           v_me::json,
    'checkins',     (select coalesce(json_agg(json_build_object(
                        'bar_id', c.bar_id, 'bar_name', c.bar_name, 'lat', c.lat, 'lng', c.lng,
                        'name', case when c.user_id = v_uid
                                     then (select min(mm.display_name) from public.group_members mm where mm.user_id = v_uid)
                                     else f.fname end,
                        'is_mine', c.user_id = v_uid,
                        'is_friend', c.user_id <> v_uid and f.fname is not null,
                        'created_at', case when c.user_id = v_uid or f.fname is not null then c.created_at
                                           else to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900) end
                      ) order by c.created_at), '[]'::json)
                       from (select * from public.checkins c0
                              where c0.expires_at > now()
                              order by c0.created_at limit 2000) c
                       left join lateral (
                         select min(am.display_name) as fname
                           from public.group_members am
                           join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
                          where am.user_id = c.user_id and c.user_id <> v_uid
                       ) f on true
                      where c.user_id = v_uid or f.fname is not null
                         or (c.lat between v_a and v_c and c.lng between v_b and v_d)),
    'rallies',      (select coalesce(json_agg(to_json(r) order by r.created_at desc, r.id desc), '[]'::json)
                       from public.olnu_rally_rows(v_uid, null) r),
    'heat',         case when coalesce(p_heat, false) then
                      (select coalesce(json_agg(json_build_array(h.lat, h.lng, h.w)), '[]'::json)
                         from public.olnu_heat(v_a - (v_c - v_a) * 0.5, v_b - (v_d - v_b) * 0.5,
                                               v_c + (v_c - v_a) * 0.5, v_d + (v_d - v_b) * 0.5, 3000) h)
                    end
  );
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants: authenticated only
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  fns text[] := array[
    'public.live_beers()',
    'public.heat_points()',
    'public.ghost_points()',
    'public.post_beer_v2(float8, float8, bool, bool)',
    'public.undo_beer()',
    'public.skal_v2(text)',
    'public.react_v2(text, text)',
    'public.poll_v2(float8, float8, float8, float8, timestamptz, bool)'
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

-- ---------------------------------------------------------------------------
-- 7. Fill snap_* and the heat cells for rows that exist already (run again after a bars_lite import)
-- ---------------------------------------------------------------------------
select public.olnu_resnap();

-- ===========================================================================
-- 0018_after.sql (v16 EFTERÅT, omgång 3)
-- ===========================================================================
-- Öl Nu v16 EFTERÅT (omgång 3: efteråt, socialt och krogar). Additive. Safe to run again.
-- Needs 0001-0015 (0014 optional: beer types; 0015 optional: bars_lite names).
-- * Kom hem säkert: mark_home(), home_status()           * "Jag kollar": claim_medevac(), medevac_checks()
-- * Bakisrapporten: my_night_report()                     * Öl Wrapped: my_wrapped()
-- * Högtidsläge: new holiday medals (olnu_medal_eval_after) * Röstmeddelande: post_voice(), group_voices(), voice_audio()
-- * Stad mot stad: city_league() (points, never total beers) * Stammis-krona: bar_regulars() (most NIGHTS, 30 days)
-- Rules: RLS on, no policies; SECURITY DEFINER + search_path; EXECUTE for authenticated only.
-- This file has no remove-type statements on purpose (create-or-replace, "if not exists",
-- "on conflict" only). Every trigger body catches its own errors: a bug here never blocks a beer,
-- a check-in or a skål. Rows are never removed; every read filters on time.

-- ---------------------------------------------------------------------------
-- 1. Towns (for Stad mot stad). Only a town name is ever stored per night, never a place.
-- ---------------------------------------------------------------------------
create table if not exists public.olnu_towns (
  name text primary key,
  lat  float8 not null,
  lng  float8 not null
);
alter table public.olnu_towns enable row level security;

insert into public.olnu_towns (name, lat, lng) values
  ('Stockholm', 59.3293, 18.0686), ('Göteborg', 57.7089, 11.9746), ('Malmö', 55.6050, 13.0038),
  ('Uppsala', 59.8586, 17.6389), ('Västerås', 59.6099, 16.5448), ('Örebro', 59.2753, 15.2134),
  ('Linköping', 58.4108, 15.6214), ('Helsingborg', 56.0465, 12.6945), ('Jönköping', 57.7826, 14.1618),
  ('Norrköping', 58.5877, 16.1924), ('Lund', 55.7047, 13.1910), ('Umeå', 63.8258, 20.2630),
  ('Gävle', 60.6749, 17.1413), ('Borås', 57.7210, 12.9401), ('Södertälje', 59.1955, 17.6253),
  ('Eskilstuna', 59.3666, 16.5077), ('Halmstad', 56.6745, 12.8578), ('Växjö', 56.8777, 14.8091),
  ('Karlstad', 59.3793, 13.5036), ('Sundsvall', 62.3908, 17.3069), ('Luleå', 65.5848, 22.1547),
  ('Trollhättan', 58.2837, 12.2886), ('Östersund', 63.1792, 14.6357), ('Borlänge', 60.4858, 15.4371),
  ('Falun', 60.6065, 15.6355), ('Kalmar', 56.6634, 16.3566), ('Kristianstad', 56.0294, 14.1567),
  ('Skövde', 58.3903, 13.8461), ('Karlskrona', 56.1612, 15.5869), ('Uddevalla', 58.3498, 11.9356),
  ('Varberg', 57.1056, 12.2508), ('Visby', 57.6348, 18.2948), ('Kiruna', 67.8558, 20.2253),
  ('Ludvika', 60.1496, 15.1878), ('Nyköping', 58.7530, 17.0079), ('Motala', 58.5371, 15.0365),
  ('Piteå', 65.3172, 21.4794), ('Skellefteå', 64.7507, 20.9528), ('Örnsköldsvik', 63.2909, 18.7153),
  ('Mora', 61.0070, 14.5430), ('Smedjebacken', 60.1405, 15.4128), ('Avesta', 60.1455, 16.1679),
  ('Hedemora', 60.2765, 15.9881), ('Säter', 60.3466, 15.7506), ('Leksand', 60.7307, 14.9993),
  ('Rättvik', 60.8857, 15.1199), ('Grängesberg', 60.0786, 14.9967), ('Malung', 60.6855, 13.7157),
  ('Vansbro', 60.5108, 14.2244), ('Orsa', 61.1203, 14.6153), ('Älvdalen', 61.2272, 14.0393),
  ('Fagersta', 60.0040, 15.7932), ('Kopparberg', 59.8740, 14.9950), ('Lindesberg', 59.5940, 15.2290),
  ('Sala', 59.9200, 16.6060), ('Sandviken', 60.6199, 16.7759), ('Hofors', 60.5460, 16.2870),
  ('Köping', 59.5140, 15.9930), ('Arboga', 59.3940, 15.8380), ('Enköping', 59.6360, 17.0770),
  ('Hudiksvall', 61.7290, 17.1040), ('Söderhamn', 61.3040, 17.0590), ('Bollnäs', 61.3480, 16.3940),
  ('Kristinehamn', 59.3090, 14.1080), ('Arvika', 59.6550, 12.5850), ('Lidköping', 58.5050, 13.1580),
  ('Alingsås', 57.9300, 12.5330), ('Kungsbacka', 57.4870, 12.0760), ('Ystad', 55.4290, 13.8200),
  ('Trelleborg', 55.3750, 13.1570), ('Landskrona', 55.8700, 12.8300), ('Västervik', 57.7580, 16.6370),
  ('Härnösand', 62.6320, 17.9380), ('Kramfors', 62.9310, 17.7770), ('Boden', 65.8250, 21.6890),
  ('Gällivare', 67.1330, 20.6600), ('Haparanda', 65.8350, 24.1370), ('Lycksele', 64.5950, 18.6760),
  ('Sälen', 61.1600, 13.2650), ('Åre', 63.3990, 13.0810)
on conflict (name) do update set lat = excluded.lat, lng = excluded.lng;

-- Nearest town within 30 km (null when none).
create or replace function public.olnu_town_of(p_lat float8, p_lng float8)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select t.name from public.olnu_towns t
   where p_lat is not null and p_lng is not null
     and abs(t.lat - p_lat) < 0.3 and abs(t.lng - p_lng) < 0.6
   order by (t.lat - p_lat) ^ 2 + ((t.lng - p_lng) * cos(radians(p_lat))) ^ 2
   limit 1;
$$;

-- Display name of p_user as seen by p_viewer: own name, or the name in a shared group, else null.
create or replace function public.olnu_name_for(p_viewer uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p_viewer = p_user
    then (select min(m.display_name) from public.group_members m where m.user_id = p_user)
    else (select min(t.display_name) from public.group_members t
            join public.group_members v on v.group_id = t.group_id and v.user_id = p_viewer
           where t.user_id = p_user) end;
$$;

create or replace function public.olnu_shares_group(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.group_members a
                   join public.group_members b on b.group_id = a.group_id and b.user_id = p_b
                  where a.user_id = p_a);
$$;

-- ---------------------------------------------------------------------------
-- 2. Night facts (one row per user per night; history starts with v16)
-- ---------------------------------------------------------------------------
create table if not exists public.after_nights (
  user_id    uuid not null,
  night      timestamptz not null,
  town       text,
  out        boolean not null default false,
  checkins   int not null default 0,
  skal_given int not null default 0,
  skal_got   int not null default 0,
  home_at    timestamptz,
  primary key (user_id, night)
);
create index if not exists after_nights_night_idx on public.after_nights (night);
alter table public.after_nights enable row level security;

create or replace function public.olnu_after_beers_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ob int := 0;
  v_oo int := 0;
begin
  begin
    if tg_op = 'UPDATE' then
      v_ob := coalesce(old.beer_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if coalesce(new.beer_count, 0) > v_ob or coalesce(new.other_count, 0) > v_oo then
      insert into public.after_nights as a (user_id, night, town, out)
      values (new.user_id, new.expires_at, public.olnu_town_of(new.lat, new.lng), true)
      on conflict (user_id, night) do update
         set out = true, town = coalesce(a.town, excluded.town);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_after_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_after_beers_tg();

create or replace function public.olnu_after_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' or new.created_at is distinct from old.created_at then
      insert into public.after_nights as a (user_id, night, town, checkins)
      values (new.user_id, public.olnu_night_of(now()), public.olnu_town_of(new.lat, new.lng), 1)
      on conflict (user_id, night) do update
         set checkins = a.checkins + 1, town = coalesce(a.town, excluded.town);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_after_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_after_checkin_tg();

create or replace function public.olnu_after_skal_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_night timestamptz := public.olnu_night_of(now());
begin
  begin
    insert into public.after_nights as a (user_id, night, skal_given) values (new.user_id, v_night, 1)
    on conflict (user_id, night) do update set skal_given = a.skal_given + 1;
    select b.user_id into v_owner from public.beers b where b.id = new.beer_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.after_nights as a (user_id, night, skal_got) values (v_owner, v_night, 1)
      on conflict (user_id, night) do update set skal_got = a.skal_got + 1;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_after_skals
  after insert on public.skals
  for each row execute function public.olnu_after_skal_tg();

-- Backfill tonight from live rows (only fills empty rows).
insert into public.after_nights (user_id, night, town, out)
select b.user_id, b.expires_at, public.olnu_town_of(b.lat, b.lng), true
  from public.beers b
 where b.expires_at > now() and (b.beer_count > 0 or coalesce(b.other_count, 0) > 0)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Kom hem säkert
-- ---------------------------------------------------------------------------
-- mark_home() -> jsonb {ok, home_at, reason?}. Needs a beer row tonight with a drink.
create or replace function public.mark_home()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_b   record;
  v_at  timestamptz;
begin
  select b.expires_at, b.lat, b.lng into v_b from public.beers b
   where b.user_id = v_uid and b.expires_at > now() and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_night');
  end if;
  insert into public.after_nights as a (user_id, night, town, out, home_at)
  values (v_uid, v_b.expires_at, public.olnu_town_of(v_b.lat, v_b.lng), true, now())
  on conflict (user_id, night) do update set home_at = coalesce(a.home_at, now()), out = true
  returning a.home_at into v_at;
  update public.medal_nights mn set home = true where mn.user_id = v_uid and mn.night = v_b.expires_at and not mn.home;
  return jsonb_build_object('ok', true, 'home_at', v_at);
end;
$$;

-- home_status(p_last default false) -> one row per member of each of the caller's groups.
-- p_last = false: tonight; true: last night (the morning-after card).
create or replace function public.home_status(p_last boolean default false)
returns table (group_id uuid, group_name text, name text, is_me boolean, beers int, others int,
               was_out boolean, home boolean, home_at timestamptz, live boolean, night timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := case when coalesce(p_last, false)
                           then public.olnu_night_of(now() - interval '24 hours')
                           else public.olnu_night_of(now()) end;
begin
  return query
  select g.id, g.name, gm.display_name, gm.user_id = v_uid,
         coalesce(mn.beers, 0), coalesce(mn.others, 0),
         coalesce(mn.beers, 0) + coalesce(mn.others, 0) > 0 or coalesce(an.out, false),
         an.home_at is not null or coalesce(mn.home, false),
         an.home_at,
         (not coalesce(p_last, false)) and exists (select 1 from public.beers b where b.user_id = gm.user_id
            and b.expires_at > now() and not b.stopped and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)),
         v_night
    from public.group_members me
    join public.groups g on g.id = me.group_id
    join public.group_members gm on gm.group_id = me.group_id
    left join public.medal_nights mn on mn.user_id = gm.user_id and mn.night = v_night
    left join public.after_nights an on an.user_id = gm.user_id and an.night = v_night
   where me.user_id = v_uid
   order by g.name, gm.display_name
   limit 1000;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. "Jag kollar" (MEDEVAC buddy check). First tap owns it.
-- ---------------------------------------------------------------------------
create table if not exists public.medevac_checks (
  id         bigserial primary key,
  target     uuid not null,
  night      timestamptz not null,
  checker    uuid not null,
  created_at timestamptz not null default now(),
  notified   boolean not null default false,
  unique (target, night)
);
create index if not exists medevac_checks_night_idx on public.medevac_checks (night);
alter table public.medevac_checks enable row level security;

-- claim_medevac(p_beer_id) -> jsonb {ok, mine, id, checker}. ok=false = someone was first.
-- Errors: beer_not_found (not live or under 10 beers), own_beer, not_friend.
create or replace function public.claim_medevac(p_beer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_b   record;
  v_row public.medevac_checks;
begin
  select b.user_id, b.expires_at, b.beer_count into v_b from public.beers b
   where b.id = p_beer_id and b.expires_at > now();
  if not found or coalesce(v_b.beer_count, 0) < 10 then
    raise exception 'beer_not_found';
  end if;
  if v_b.user_id = v_uid then
    raise exception 'own_beer';
  end if;
  if not public.olnu_shares_group(v_uid, v_b.user_id) then
    raise exception 'not_friend';
  end if;
  insert into public.medevac_checks (target, night, checker)
  values (v_b.user_id, v_b.expires_at, v_uid)
  on conflict (target, night) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('ok', true, 'mine', true, 'id', v_row.id, 'checker', public.olnu_name_for(v_uid, v_uid));
  end if;
  select * into v_row from public.medevac_checks c where c.target = v_b.user_id and c.night = v_b.expires_at;
  return jsonb_build_object('ok', false, 'mine', v_row.checker = v_uid, 'id', v_row.id,
    'checker', public.olnu_name_for(v_uid, v_row.checker));
end;
$$;

-- medevac_checks() -> tonight's checks the caller may see (target or checker is the caller or a group-mate).
create or replace function public.medevac_checks()
returns table (id bigint, beer_id bigint, target_name text, checker_name text,
               target_is_me boolean, checker_is_me boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select c.id, b.id, public.olnu_name_for(v_uid, c.target), public.olnu_name_for(v_uid, c.checker),
         c.target = v_uid, c.checker = v_uid, c.created_at
    from public.medevac_checks c
    left join public.beers b on b.user_id = c.target and b.expires_at = c.night
   where c.night > now()
     and (c.target = v_uid or c.checker = v_uid
          or public.olnu_shares_group(v_uid, c.target) or public.olnu_shares_group(v_uid, c.checker))
   order by c.created_at desc
   limit 50;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Bakisrapporten: my_night_report(p_last default true) -> jsonb
-- ---------------------------------------------------------------------------
create or replace function public.my_night_report(p_last boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := case when coalesce(p_last, true)
                           then public.olnu_night_of(now() - interval '24 hours')
                           else public.olnu_night_of(now()) end;
  v_mn    record;
  v_an    record;
  v_bars  int := 0;
  v_types jsonb := '[]'::jsonb;
  v_week  int := 0;
begin
  select mn.beers, mn.others, mn.first_at, mn.home into v_mn from public.medal_nights mn
   where mn.user_id = v_uid and mn.night = v_night;
  select an.checkins, an.skal_given, an.skal_got, an.home_at, an.town into v_an from public.after_nights an
   where an.user_id = v_uid and an.night = v_night;
  select count(distinct c.bar_id) into v_bars from public.medal_checkins c where c.user_id = v_uid and c.night = v_night;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'n', x.n) order by x.n desc), '[]'::jsonb) into v_types
      from (select bt.type, count(*)::int n from public.beer_types bt
             where bt.user_id = v_uid and bt.night = v_night group by bt.type) x;
  exception when others then
    v_types := '[]'::jsonb;
  end;
  select count(*) into v_week from public.medal_nights mn
   where mn.user_id = v_uid and mn.night < v_night and mn.night >= v_night - interval '7 days'
     and mn.beers + mn.others > 0;
  return jsonb_build_object(
    'night', v_night,
    'evening', public.olnu_evening(v_night),
    'out', coalesce(v_mn.beers, 0) + coalesce(v_mn.others, 0) > 0,
    'beers', coalesce(v_mn.beers, 0),
    'others', coalesce(v_mn.others, 0),
    'first_at', v_mn.first_at,
    'bars', coalesce(v_bars, 0),
    'checkins', coalesce(v_an.checkins, 0),
    'skal_given', coalesce(v_an.skal_given, 0),
    'skal_got', coalesce(v_an.skal_got, 0),
    'home', v_an.home_at is not null or coalesce(v_mn.home, false),
    'home_at', v_an.home_at,
    'town', v_an.town,
    'types', v_types,
    'nights_week_before', coalesce(v_week, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Öl Wrapped: my_wrapped(p_kind 'month'|'year', p_offset default 1) -> jsonb
--    offset 1 = last month / last year, 0 = this one so far. Evenings (the day the night started).
-- ---------------------------------------------------------------------------
create or replace function public.my_wrapped(p_kind text default 'month', p_offset int default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_kind text := case when lower(coalesce(p_kind, '')) = 'year' then 'year' else 'month' end;
  v_off  int := greatest(0, least(24, coalesce(p_offset, 1)));
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  v_from date;
  v_to   date;
  v_nights int := 0; v_beers int := 0; v_others int := 0; v_home int := 0;
  v_bars int := 0; v_sg int := 0; v_sr int := 0; v_towns int := 0;
  v_fav record; v_best record; v_type text; v_type_n int := 0;
  v_fav_name text;
  v_total int := public.olnu_lifetime(v_uid);
  v_title text;
begin
  if v_kind = 'year' then
    v_from := (date_trunc('year', v_today) - make_interval(years => v_off))::date;
    v_to := (v_from + interval '1 year')::date - 1;
  else
    v_from := (date_trunc('month', v_today) - make_interval(months => v_off))::date;
    v_to := (v_from + interval '1 month')::date - 1;
  end if;

  select count(*) filter (where mn.beers + mn.others > 0), coalesce(sum(mn.beers), 0), coalesce(sum(mn.others), 0),
         count(*) filter (where mn.home and mn.beers + mn.others > 0)
    into v_nights, v_beers, v_others, v_home
    from public.medal_nights mn
   where mn.user_id = v_uid and public.olnu_evening(mn.night) between v_from and v_to;

  select count(distinct c.bar_id) into v_bars from public.medal_checkins c
   where c.user_id = v_uid and public.olnu_evening(c.night) between v_from and v_to;

  select c.bar_id, count(distinct c.night)::int n into v_fav from public.medal_checkins c
   where c.user_id = v_uid and public.olnu_evening(c.night) between v_from and v_to
   group by c.bar_id order by count(distinct c.night) desc, max(c.night) desc limit 1;
  if v_fav.bar_id is not null then
    begin
      select bl.name into v_fav_name from public.bars_lite bl where bl.id = v_fav.bar_id;
    exception when others then
      v_fav_name := null;
    end;
    if v_fav_name is null then
      select t.bar_name into v_fav_name from public.bar_taps t where t.bar_id = v_fav.bar_id and t.bar_name is not null
       order by t.last_at desc limit 1;
    end if;
    if v_fav_name is null then
      select c.bar_name into v_fav_name from public.checkins c where c.bar_id = v_fav.bar_id order by c.created_at desc limit 1;
    end if;
  end if;

  select coalesce(sum(an.skal_given), 0), coalesce(sum(an.skal_got), 0),
         count(distinct an.town) filter (where an.town is not null),
         greatest(v_home, count(*) filter (where an.home_at is not null))
    into v_sg, v_sr, v_towns, v_home
    from public.after_nights an
   where an.user_id = v_uid and public.olnu_evening(an.night) between v_from and v_to;

  -- Best night: the most social one (bars, skål, home safe), beers only break ties. Never "most beers".
  select public.olnu_evening(mn.night) as evening, mn.beers,
         coalesce((select count(distinct c.bar_id) from public.medal_checkins c where c.user_id = v_uid and c.night = mn.night), 0) as bars
    into v_best
    from public.medal_nights mn
    left join public.after_nights an on an.user_id = mn.user_id and an.night = mn.night
   where mn.user_id = v_uid and public.olnu_evening(mn.night) between v_from and v_to and mn.beers + mn.others > 0
   order by coalesce((select count(distinct c.bar_id) from public.medal_checkins c where c.user_id = v_uid and c.night = mn.night), 0) * 3
            + coalesce(an.skal_given, 0) + coalesce(an.skal_got, 0) + case when an.home_at is not null or mn.home then 2 else 0 end desc,
            mn.beers desc, mn.night desc
   limit 1;

  begin
    select bt.type, count(*)::int into v_type, v_type_n from public.beer_types bt
     where bt.user_id = v_uid and public.olnu_evening(bt.night) between v_from and v_to
     group by bt.type order by count(*) desc, max(bt.created_at) desc limit 1;
  exception when others then
    v_type := null; v_type_n := 0;
  end;

  select t.title into v_title from public.olnu_titles() t where t.at <= v_total order by t.at desc limit 1;

  return jsonb_build_object(
    'kind', v_kind, 'from', v_from, 'to', v_to,
    'nights', coalesce(v_nights, 0), 'beers', coalesce(v_beers, 0), 'others', coalesce(v_others, 0),
    'home_nights', coalesce(v_home, 0), 'bars', coalesce(v_bars, 0), 'towns', coalesce(v_towns, 0),
    'skal_given', coalesce(v_sg, 0), 'skal_got', coalesce(v_sr, 0),
    'fav_bar_id', v_fav.bar_id, 'fav_bar_name', v_fav_name, 'fav_bar_nights', coalesce(v_fav.n, 0),
    'best_evening', v_best.evening, 'best_beers', coalesce(v_best.beers, 0), 'best_bars', coalesce(v_best.bars, 0),
    'top_type', v_type, 'top_type_n', coalesce(v_type_n, 0),
    'total', coalesce(v_total, 0), 'title', v_title);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Högtidsläge: more holiday medals (0012 has valborg, midsommar, lucia, nyar)
-- ---------------------------------------------------------------------------
-- Easter Sunday (Gregorian, anonymous algorithm).
create or replace function public.olnu_easter(p_year int)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  a int := p_year % 19; b int := p_year / 100; c int := p_year % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_year, mo, dy);
end;
$$;

-- Holiday id of an evening date (null = none). Same rules as docs/js/after.js holidayOf().
create or replace function public.olnu_holiday(p_day date)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_md  text := to_char(p_day, 'MM-DD');
  v_dow int := extract(isodow from p_day)::int;
  v_e   date := public.olnu_easter(extract(year from p_day)::int);
  v_adv date;
begin
  if v_md = '12-24' then return 'julafton'; end if;
  if v_md = '12-31' then return 'nyarsafton'; end if;
  if v_md = '12-13' then return 'lucia'; end if;
  if v_md = '04-30' then return 'valborg'; end if;
  if v_md = '10-31' then return 'halloween'; end if;
  if v_dow = 5 and v_md between '06-19' and '06-25' then return 'midsommar'; end if;
  if p_day between v_e - 2 and v_e then return 'pask'; end if;
  if p_day = v_e - 47 then return 'fettisdagen'; end if;
  -- First Sunday of Advent: the Sunday between 27 Nov and 3 Dec.
  v_adv := make_date(extract(year from p_day)::int, 12, 3);
  v_adv := v_adv - (extract(isodow from v_adv)::int % 7);
  if p_day = v_adv then return 'forstaAdvent'; end if;
  if v_dow = 5 and extract(day from p_day) = 13 then return 'fredag13'; end if;
  if v_dow = 5 and extract(month from p_day) = 8 then return 'kraftskiva'; end if;
  return null;
end;
$$;

-- New medal ids: jul, fettis, pask, advent, fredag13, halloween, kraftskiva (stack per year;
-- fredag13 per occurrence) and kompisvakt (said "🚑 Jag kollar" for a friend; stacks). Caring, never a drinking goal.
create or replace function public.olnu_medal_eval_after(p_uid uuid)
returns table (medal text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_jul int := 0; v_fett int := 0; v_pask int := 0; v_adv int := 0; v_f13 int := 0; v_hall int := 0; v_kraft int := 0;
  v_kv int := 0;
begin
  begin
    select count(distinct extract(year from x.ev)) filter (where x.h = 'julafton'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'fettisdagen'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'pask'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'forstaAdvent'),
           count(distinct x.ev) filter (where x.h = 'fredag13'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'halloween'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'kraftskiva')
      into v_jul, v_fett, v_pask, v_adv, v_f13, v_hall, v_kraft
      from (select public.olnu_evening(mn.night) as ev, public.olnu_holiday(public.olnu_evening(mn.night)) as h
              from public.medal_nights mn where mn.user_id = p_uid and mn.beers >= 1) x
     where x.h is not null;
    select count(*) into v_kv from public.medevac_checks c where c.checker = p_uid;
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('jul', v_jul), ('fettis', v_fett), ('pask', v_pask), ('advent', v_adv),
    ('fredag13', v_f13), ('halloween', v_hall), ('kraftskiva', v_kraft), ('kompisvakt', v_kv)
  ) as v(medal, n);
end;
$$;

-- Same name and return type as 0012/0014. Now unions EVERY public function named
-- olnu_medal_eval / olnu_medal_eval_<x>(uuid) returning (medal text, n int), so later
-- rounds only add an eval function and never need to touch this one again. Counts never go down.
create or replace function public.olnu_medal_store(p_uid uuid)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
begin
  select string_agg(format('select x.medal as m, x.n from public.%I($1) x', p.proname), ' union all ' order by p.proname)
    into v_sql
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname ~ '^olnu_medal_eval(_[a-z0-9]+)?$'
     and pg_get_function_identity_arguments(p.oid) = 'p_uid uuid'
     and pg_get_function_result(p.oid) = 'TABLE(medal text, n integer)';
  if v_sql is null then
    return;
  end if;
  return query execute
    'with ev as (' || v_sql || '),
     e as (select ev.m, max(ev.n)::int as n from ev where ev.n >= 1 group by ev.m),
     up as (
       insert into public.user_medals as um (user_id, medal, count, earned_at, updated_at)
       select $1, e.m, e.n, now(), now() from e
       on conflict on constraint user_medals_pkey do update
          set count = greatest(um.count, excluded.count), updated_at = now()
        where excluded.count > um.count
       returning um.medal, um.count, (um.earned_at = now()) as fresh, um.earned_at)
     select up.medal, up.count, up.fresh, up.earned_at from up'
  using p_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Röstmeddelande (voice skål, max 5 s / 60 KB, lives until 05:00, group members only)
-- ---------------------------------------------------------------------------
create table if not exists public.voice_msgs (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  mime       text not null,
  dur_ms     int not null default 0,
  audio      bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default public.olnu_next_expiry(),
  notified   boolean not null default false
);
create index if not exists voice_msgs_group_idx on public.voice_msgs (group_id, id);
create index if not exists voice_msgs_user_idx on public.voice_msgs (user_id, created_at);
alter table public.voice_msgs enable row level security;

-- post_voice -> jsonb {id, created_at, left}. Errors: not_member, invalid_voice, voice_limit (10 per night), slow_down (5 s).
create or replace function public.post_voice(p_group_id uuid, p_mime text, p_b64 text, p_dur_ms int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_mime text := lower(btrim(coalesce(p_mime, '')));
  v_data bytea;
  v_n    int;
  v_row  public.voice_msgs;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_mime !~ '^audio/(webm|ogg|mp4|aac|mpeg|x-m4a)(; ?codecs="?[a-z0-9.,]{1,30}"?)?$' then
    raise exception 'invalid_voice';
  end if;
  if p_b64 is null or length(p_b64) > 90000 then
    raise exception 'invalid_voice';
  end if;
  begin
    v_data := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_voice';
  end;
  if octet_length(v_data) < 100 or octet_length(v_data) > 61440 then
    raise exception 'invalid_voice';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_voice:' || v_uid::text, 0));
  if exists (select 1 from public.voice_msgs v where v.user_id = v_uid and v.created_at > now() - interval '5 seconds') then
    raise exception 'slow_down';
  end if;
  select count(*) into v_n from public.voice_msgs v where v.user_id = v_uid and v.expires_at = public.olnu_next_expiry();
  if v_n >= 10 then
    raise exception 'voice_limit';
  end if;
  insert into public.voice_msgs (group_id, user_id, mime, dur_ms, audio)
  values (p_group_id, v_uid, v_mime, greatest(0, least(6000, coalesce(p_dur_ms, 0))), v_data)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'left', 9 - v_n);
end;
$$;

-- group_voices(p_group_id, p_after_id default 0) -> live voice messages (no audio), oldest first, max 30.
create or replace function public.group_voices(p_group_id uuid, p_after_id bigint default 0)
returns table (id bigint, name text, mime text, dur_ms int, bytes int, created_at timestamptz, is_me boolean)
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
  select x.id, x.name, x.mime, x.dur_ms, x.bytes, x.created_at, x.is_me from (
    select v.id, gm.display_name as name, v.mime, v.dur_ms, octet_length(v.audio) as bytes, v.created_at, v.user_id = v_uid as is_me
      from public.voice_msgs v
      left join public.group_members gm on gm.group_id = v.group_id and gm.user_id = v.user_id
     where v.group_id = p_group_id and v.expires_at > now() and v.id > coalesce(p_after_id, 0)
     order by v.id desc limit 30) x
   order by x.id;
end;
$$;

-- voice_audio(p_id) -> jsonb {id, mime, b64}. Errors: voice_not_found, not_member.
create or replace function public.voice_audio(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.voice_msgs;
begin
  select * into v_row from public.voice_msgs v where v.id = p_id and v.expires_at > now();
  if not found then
    raise exception 'voice_not_found';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'dur_ms', v_row.dur_ms,
    'b64', replace(encode(v_row.audio, 'base64'), E'\n', ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Stad mot stad: weekly town league. NOT total beers (no competition drinking).
--    Per user and night in the town: 1 night out + 1 home safe + 0.5 per check-in (max 5) + 0.25 per skål given (max 10).
--    poäng = round(10 * sum / active users). Ranked only with >= 3 active users.
-- ---------------------------------------------------------------------------
create or replace function public.city_league(p_week_offset int default 0)
returns table (rank int, town text, points int, users int, nights int, checkins int, skal int, home int, is_mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_from date := public.olnu_week_start(now()) - 7 * greatest(0, least(52, coalesce(p_week_offset, 0)));
  v_to   date := v_from + 6;
  v_mine text;
begin
  select an.town into v_mine from public.after_nights an
   where an.user_id = v_uid and an.town is not null and public.olnu_evening(an.night) between v_from and v_to
   group by an.town order by count(*) desc, max(an.night) desc limit 1;
  if v_mine is null then
    select an.town into v_mine from public.after_nights an
     where an.user_id = v_uid and an.town is not null order by an.night desc limit 1;
  end if;
  return query
  with f as (
    select an.town as tw, an.user_id as u,
           case when an.out then 1 else 0 end as o,
           case when an.out and an.home_at is not null then 1 else 0 end as h,
           least(an.checkins, 5) as c, least(an.skal_given, 10) as s
      from public.after_nights an
     where an.town is not null and public.olnu_evening(an.night) between v_from and v_to
       and (an.out or an.checkins > 0 or an.skal_given > 0)
  ),
  t as (
    select f.tw, count(distinct f.u)::int as us, sum(f.o)::int as ni, sum(f.c)::int as ci, sum(f.s)::int as sk, sum(f.h)::int as ho,
           round(10.0 * (sum(f.o) + sum(f.h) + 0.5 * sum(f.c) + 0.25 * sum(f.s)) / greatest(1, count(distinct f.u)))::int as pts
      from f group by f.tw
  ),
  r as (
    select t.*, case when t.us >= 3 then (row_number() over (order by (t.us >= 3) desc, t.pts desc, t.us desc, t.tw))::int end as rk
      from t
  )
  select r.rk, r.tw, r.pts, r.us, r.ni, r.ci, r.sk, r.ho, r.tw = v_mine
    from r
   where (r.rk is not null and r.rk <= 12) or r.tw = v_mine
   order by r.rk nulls last, r.tw;
  if v_mine is not null and not exists (select 1 from public.after_nights an where an.town = v_mine
       and public.olnu_evening(an.night) between v_from and v_to) then
    return query select null::int, v_mine, 0, 0, 0, 0, 0, 0, true;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Stammis-krona: most NIGHTS at a bar in the last 30 days (not most beers). bar_kings stays for old apps.
--     bar_regulars(p_bar_id) -> top 3 (min 2 nights) + the caller's own row. Names only for self / group-mates.
-- ---------------------------------------------------------------------------
create or replace function public.bar_regulars(p_bar_id text)
returns table (rank int, name text, nights int, is_me boolean, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with n as (
    select c.user_id as u, count(distinct c.night)::int as k, max(c.night) as la
      from public.medal_checkins c
     where c.bar_id = left(coalesce(p_bar_id, ''), 80) and c.night > now() - interval '30 days'
     group by c.user_id
  ),
  r as (select n.*, (row_number() over (order by n.k desc, n.la asc, n.u))::int as rk from n)
  select r.rk, public.olnu_name_for(v_uid, r.u), r.k, r.u = v_uid, r.la
    from r
   where (r.rk <= 3 and r.k >= 2) or r.u = v_uid
   order by r.rk;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
revoke all on table public.olnu_towns, public.after_nights, public.medevac_checks, public.voice_msgs from public;
do $$
declare
  f text;
  fns text[] := array[
    'public.mark_home()',
    'public.home_status(boolean)',
    'public.claim_medevac(bigint)',
    'public.medevac_checks()',
    'public.my_night_report(boolean)',
    'public.my_wrapped(text, integer)',
    'public.post_voice(uuid, text, text, integer)',
    'public.group_voices(uuid, bigint)',
    'public.voice_audio(bigint)',
    'public.city_league(integer)',
    'public.bar_regulars(text)'
  ];
  internal text[] := array[
    'public.olnu_town_of(double precision, double precision)',
    'public.olnu_name_for(uuid, uuid)',
    'public.olnu_shares_group(uuid, uuid)',
    'public.olnu_after_beers_tg()',
    'public.olnu_after_checkin_tg()',
    'public.olnu_after_skal_tg()',
    'public.olnu_easter(integer)',
    'public.olnu_holiday(date)',
    'public.olnu_medal_eval_after(uuid)',
    'public.olnu_medal_store(uuid)'
  ];
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.olnu_towns, public.after_nights, public.medevac_checks, public.voice_msgs from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.olnu_towns, public.after_nights, public.medevac_checks, public.voice_msgs from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.olnu_towns, public.after_nights, public.medevac_checks, public.voice_msgs to service_role';
    execute 'grant usage, select on sequence public.medevac_checks_id_seq, public.voice_msgs_id_seq to service_role';
  end if;
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

-- ===== supabase/migrations/0016_privacy_erase.sql =====
-- Öl Nu v14: privacy (server part of the v14 client). Additive. Safe to run again.
-- Binding spec: CONTRACT.md, section "v14 CLIENT".
--  1. olnu_near_bar(): restaurants, cafés and fast food places (bars_lite.type restaurant | fast_food | cafe,
--     ids "pl_<lat*1e5>_<lng*1e5>") are snap points too, within 40 m (bars: 75 m); a bar always wins.
--  2. delete_my_data(): "Radera allt om mig". Rows are never removed (this file has no remove-type
--     statements on purpose). Instead every row of the caller is anonymized: it is moved to a new random
--     user id that no login can ever have, positions are set to 0/0 or null, texts are blanked, and live
--     things end now. The caller leaves all groups and the push subscriptions go (existing RPC logic).
--     Afterwards the auth user owns nothing. The client then signs out and clears the phone.
-- Needs 0001-0015 first. Postgres 14+.

-- ---------------------------------------------------------------------------
-- 1. Nearest snap point: bars (75 m) first, then restaurants / cafés / fast food (40 m)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_near_bar(p_lat float8, p_lng float8)
returns table (id text, lat float8, lng float8)
language sql
stable
set search_path = public
as $$
  select bl.id, bl.lat, bl.lng
    from public.bars_lite bl
   where bl.active
     and bl.lat between p_lat - 0.0007 and p_lat + 0.0007
     and bl.lng between p_lng - 0.0019 and p_lng + 0.0019
     and power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2)
         <= case when coalesce(bl.type, '') in ('restaurant', 'fast_food', 'cafe') then 1600 else 5625 end
   order by (coalesce(bl.type, '') in ('restaurant', 'fast_food', 'cafe')),
            power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2), bl.id
   limit 1;
$$;

revoke all on function public.olnu_near_bar(float8, float8) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_near_bar(float8, float8) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_near_bar(float8, float8) from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. delete_my_data() -> jsonb {ok, groups_left, subscriptions, moved_rows}
-- ---------------------------------------------------------------------------
-- Every row of the caller goes to v_new (a fresh random uuid that is not an auth user), so nothing
-- links it to the person any more. Group-wide counts (a skål on a friend's pin, a beer in tonight's
-- totals) stay as anonymous numbers. Earned medals and night facts are no longer anyone's.
create or replace function public.delete_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_new  uuid := gen_random_uuid();
  v_g    uuid;
  v_ep   text;
  v_ng   int := 0;
  v_ns   int := 0;
  v_rows int := 0;
  v_n    int;
  v_tab  text;
  v_col  text;
begin
  -- Groups: leave every group (the old leave_group logic; an empty group goes away with it).
  for v_g in select gm.group_id from public.group_members gm where gm.user_id = v_uid loop
    perform public.leave_group(v_g);
    v_ng := v_ng + 1;
  end loop;
  update public.groups g set created_by = null where g.created_by = v_uid;

  -- Push: the old delete_push_subscription logic for each endpoint.
  for v_ep in select ps.endpoint from public.push_subscriptions ps where ps.user_id = v_uid loop
    perform public.delete_push_subscription(v_ep);
    v_ns := v_ns + 1;
  end loop;

  -- Stats and medal facts first: the medal triggers on beers / checkins / bar_taps (fired by the
  -- updates below) then find these rows already moved and add nothing that could clash.
  update public.week_beers w set user_id = v_new where w.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.bar_taps t set user_id = v_new, lat = null, lng = null where t.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.user_medals um set user_id = v_new where um.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.medal_nights mn set user_id = v_new, cell = null where mn.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.medal_checkins mc set user_id = v_new where mc.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.medal_counts mo set user_id = v_new where mo.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.medal_claims ml set user_id = v_new where ml.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.push_sent p set user_id = v_new where p.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  -- Pin: hidden now, no position, no undo state.
  update public.beers b
     set user_id = v_new, lat = 0, lng = 0, precise = false, stopped = true, ghost = false,
         expires_at = least(b.expires_at, now()),
         prev_lat = null, prev_lng = null, prev_precise = null, prev_stopped = null, prev_ghost = null,
         prev_beer_at = null, prev_for = null
   where b.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.checkins c
     set user_id = v_new, lat = 0, lng = 0, expires_at = least(c.expires_at, now())
   where c.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.group_msgs m
     set user_id = v_new, body = '🗑️', expires_at = least(m.expires_at, now())
   where m.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.rallies r
     set user_id = v_new, body = '🗑️', place = null, lat = null, lng = null, closed = true,
         expires_at = least(r.expires_at, now())
   where r.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.rally_answers a set user_id = v_new where a.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.skals s set user_id = v_new where s.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.reactions x set user_id = v_new, active = false where x.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  -- v12 tables (0014 is optional): only when they exist.
  if to_regclass('public.bar_queue') is not null then
    execute 'update public.bar_queue q set user_id = $1, expires_at = least(q.expires_at, now()) where q.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.bar_offers o set user_id = $1, expires_at = least(o.expires_at, now()) where o.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.bar_offer_votes v set user_id = $1 where v.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.bar_tips tp set user_id = $1, body = null where tp.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.beer_types bt set user_id = $1, lat = null, lng = null where bt.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.group_flags f set updated_by = null where f.updated_by = $1' using v_uid;
  end if;

  -- Newer tables (games, voice, chat likes, …): blank what is personal, then move every uuid column that
  -- points at the caller to v_new. Generic, so tables added later are covered too. Each statement runs in
  -- its own block: one odd table can never stop the rest.
  begin
    if to_regclass('public.voice_msgs') is not null then
      execute 'update public.voice_msgs v set audio = ''\x''::bytea, dur_ms = 0, expires_at = least(v.expires_at, now()) where v.user_id = $1' using v_uid;
    end if;
  exception when others then null;
  end;
  begin
    if to_regclass('public.game_guesses') is not null then
      execute 'update public.game_guesses g set lat = null, lng = null, town = null where g.user_id = $1' using v_uid;
    end if;
  exception when others then null;
  end;
  begin
    if to_regclass('public.after_nights') is not null then
      execute 'update public.after_nights a set town = null where a.user_id = $1' using v_uid;
    end if;
  exception when others then null;
  end;
  for v_tab, v_col in
    select c.table_name::text, c.column_name::text
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and tb.table_type = 'BASE TABLE' and c.data_type = 'uuid'
       and c.column_name not in ('id', 'group_id')
       and c.table_name not in ('groups', 'group_members', 'group_flags', 'push_subscriptions')
  loop
    begin
      execute format('update public.%I set %I = $1 where %I = $2', v_tab, v_col, v_col) using v_new, v_uid;
      get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    exception when others then null;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'groups_left', v_ng, 'subscriptions', v_ns, 'moved_rows', v_rows);
end;
$$;

revoke all on function public.delete_my_data() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.delete_my_data() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.delete_my_data() to authenticated';
  end if;
end $$;

-- 3. Re-snap tonight's pins and heat rows (restaurants may have been added to bars_lite).
select public.olnu_resnap();

-- ===== supabase/migrations/0017_games.sql =====
-- Öl Nu v15 LEK (omgång 2). Additive. Safe to run again. Needs 0001-0014 (0015 optional).
-- Six small group games, all for "tonight" (night = the next 05:00 Europe/Stockholm, olnu_night_of):
--   1. Kvällens uppdrag   3 missions per user per night, checked from server facts (never "drink N beers").
--   2. Krogrunda          a member draws a route of 2-6 bars; members' check-ins tick the stops.
--   3. Hemlig agent       one random member who is out gets a secret (harmless) mission; next day the
--                         group guesses who it was (one vote each), reveal when all voted or at 12:00.
--   4. Gissa kvällen      guess before 21:00 how many beers the town (20 km) logs tonight; next day the
--                         closest guess in each group is "Dagens orakel".
--   5. Kvällsbingo        one 3x3 card per group per night, members tick squares (honour system).
--   6. Sugen-status       "sugen" / "kanske" / "inte" for tonight, seen by group-mates.
-- Medals (olnu_medal_eval_games): uppdrag, uppdrag3, runda, detektiv, spion, orakel, bingo.
-- olnu_medal_store is replaced by a version that merges olnu_medal_eval() with EVERY function named
-- public.olnu_medal_eval_<x>(uuid) (0014 bars, this file games, later files only add their own).
-- All texts live in the client (docs/js/games-content.js); the server only stores ids and numbers.
-- Every internal olnu_g_* function takes p_now so the night logic can be tested; the RPCs pass now().
-- This file has no remove-type statements on purpose (create-or-replace, "if not exists",
-- "on conflict" only). Rows are never removed: every read filters on the night.

-- 0015 adds this column too (same definition); needed here so a 0014-only database works.
alter table public.beer_events add column if not exists undone boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS on, no policies, no client access)
-- ---------------------------------------------------------------------------
create table if not exists public.game_mission_cat (
  id          text primary key check (id ~ '^m[0-9]{3}$'),
  kind        text not null check (kind in ('checkin_bars', 'skal_give', 'skal_get', 'chat', 'rally_yes', 'group_out',
                                            'home', 'water', 'beer_type', 'queue_report', 'tip', 'early', 'other_none')),
  goal        int  not null check (goal between 1 and 50),
  needs_group boolean not null default false,
  active      boolean not null default true
);

create table if not exists public.game_missions (
  user_id    uuid not null,
  night      timestamptz not null,
  slot       smallint not null check (slot between 1 and 3),
  mission    text not null,
  kind       text not null,
  goal       int  not null,
  progress   int  not null default 0,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, night, slot)
);
create index if not exists game_missions_done_idx on public.game_missions (user_id, done_at);

-- Facts the server cannot see elsewhere: water taps, "Jag är hemma" time, bingo tick changes.
create table if not exists public.game_facts (
  user_id       uuid not null,
  night         timestamptz not null,
  water         int not null default 0,
  water_at      timestamptz,
  home_at       timestamptz,
  bingo_changes int not null default 0,
  primary key (user_id, night)
);

create table if not exists public.game_sugen (
  user_id    uuid not null,
  night      timestamptz not null,
  status     text not null check (status in ('sugen', 'kanske', 'inte', 'none')),
  changes    int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, night)
);

create table if not exists public.game_crawls (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  night      timestamptz not null,
  stops      jsonb not null,
  n          int not null check (n between 2 and 6),
  created_at timestamptz not null default now(),
  closed     boolean not null default false,
  done_at    timestamptz
);
create index if not exists game_crawls_group_idx on public.game_crawls (group_id, night);
create index if not exists game_crawls_user_idx  on public.game_crawls (user_id, created_at);

create table if not exists public.game_agents (
  group_id    uuid not null,
  night       timestamptz not null,
  agent       uuid not null,
  mission     int not null,
  started_by  uuid not null,
  created_at  timestamptz not null default now(),
  revealed_at timestamptz,
  correct     int,
  votes       int,
  primary key (group_id, night)
);
create index if not exists game_agents_agent_idx on public.game_agents (agent);

create table if not exists public.game_agent_votes (
  group_id   uuid not null,
  night      timestamptz not null,
  voter      uuid not null,
  suspect    uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, night, voter)
);
create index if not exists game_agent_votes_voter_idx on public.game_agent_votes (voter);

create table if not exists public.game_guesses (
  user_id    uuid not null,
  night      timestamptz not null,
  guess      int not null check (guess between 0 and 20000),
  town       text not null check (char_length(town) between 1 and 40),
  lat        float8 not null,
  lng        float8 not null,
  changes    int not null default 1,
  real       int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, night)
);
create index if not exists game_guesses_night_idx on public.game_guesses (night);

-- "Dagens orakel": the best guess per group for a finished night (only groups with 2+ guesses).
create table if not exists public.game_oracles (
  group_id   uuid not null,
  night      timestamptz not null,
  user_id    uuid not null,
  guess      int not null,
  real       int not null,
  err        float8 not null,
  guessers   int not null,
  created_at timestamptz not null default now(),
  primary key (group_id, night)
);
create index if not exists game_oracles_user_idx on public.game_oracles (user_id);

create table if not exists public.game_bingo_cards (
  group_id   uuid not null,
  night      timestamptz not null,
  card       int[] not null,
  n          int not null,
  lines      int not null default 0,
  bingo_at   timestamptz,
  created_at timestamptz not null default now(),
  primary key (group_id, night)
);

create table if not exists public.game_bingo_ticks (
  group_id   uuid not null,
  night      timestamptz not null,
  idx        smallint not null check (idx between 0 and 8),
  user_id    uuid not null,
  ticked     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (group_id, night, idx)
);
create index if not exists game_bingo_ticks_user_idx on public.game_bingo_ticks (user_id);

do $$
declare
  t text;
  tabs text[] := array['game_mission_cat', 'game_missions', 'game_facts', 'game_sugen', 'game_crawls', 'game_agents',
                       'game_agent_votes', 'game_guesses', 'game_oracles', 'game_bingo_cards', 'game_bingo_ticks'];
begin
  foreach t in array tabs loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on table public.%I to service_role', t);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on sequence public.game_crawls_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on sequence public.game_crawls_id_seq from authenticated';
  end if;
end $$;

-- Mission catalog (ids = docs/js/games-content.js; texts only in the client).
-- needs_group: only given to users who are in a group when the missions are assigned.
insert into public.game_mission_cat (id, kind, goal, needs_group) values
  ('m001', 'checkin_bars', 2, false),
  ('m002', 'checkin_bars', 3, false),
  ('m003', 'checkin_bars', 2, false),
  ('m004', 'checkin_bars', 3, false),
  ('m005', 'checkin_bars', 2, false),
  ('m006', 'checkin_bars', 4, false),
  ('m007', 'checkin_bars', 2, false),
  ('m008', 'checkin_bars', 3, false),
  ('m009', 'checkin_bars', 2, false),
  ('m010', 'checkin_bars', 3, false),
  ('m011', 'checkin_bars', 2, false),
  ('m012', 'checkin_bars', 2, false),
  ('m013', 'checkin_bars', 3, false),
  ('m014', 'checkin_bars', 2, false),
  ('m015', 'checkin_bars', 3, false),
  ('m016', 'checkin_bars', 2, false),
  ('m017', 'skal_give', 3, false),
  ('m018', 'skal_give', 5, false),
  ('m019', 'skal_give', 1, false),
  ('m020', 'skal_give', 3, false),
  ('m021', 'skal_give', 2, false),
  ('m022', 'skal_give', 4, false),
  ('m023', 'skal_give', 3, false),
  ('m024', 'skal_give', 10, false),
  ('m025', 'skal_give', 2, false),
  ('m026', 'skal_give', 5, false),
  ('m027', 'skal_give', 3, false),
  ('m028', 'skal_give', 1, false),
  ('m029', 'skal_get', 3, false),
  ('m030', 'skal_get', 5, false),
  ('m031', 'skal_get', 1, false),
  ('m032', 'skal_get', 2, false),
  ('m033', 'skal_get', 3, false),
  ('m034', 'skal_get', 4, false),
  ('m035', 'skal_get', 2, false),
  ('m036', 'skal_get', 10, false),
  ('m037', 'skal_get', 3, false),
  ('m038', 'skal_get', 6, false),
  ('m039', 'chat', 1, true),
  ('m040', 'chat', 3, true),
  ('m041', 'chat', 5, true),
  ('m042', 'chat', 1, true),
  ('m043', 'chat', 2, true),
  ('m044', 'chat', 3, true),
  ('m045', 'chat', 1, true),
  ('m046', 'chat', 4, true),
  ('m047', 'chat', 2, true),
  ('m048', 'chat', 10, true),
  ('m049', 'rally_yes', 1, true),
  ('m050', 'rally_yes', 1, true),
  ('m051', 'rally_yes', 2, true),
  ('m052', 'rally_yes', 1, true),
  ('m053', 'rally_yes', 1, true),
  ('m054', 'rally_yes', 1, true),
  ('m055', 'rally_yes', 3, true),
  ('m056', 'group_out', 3, true),
  ('m057', 'group_out', 4, true),
  ('m058', 'group_out', 2, true),
  ('m059', 'group_out', 5, true),
  ('m060', 'group_out', 3, true),
  ('m061', 'group_out', 6, true),
  ('m062', 'group_out', 3, true),
  ('m063', 'group_out', 4, true),
  ('m064', 'group_out', 2, true),
  ('m065', 'group_out', 8, true),
  ('m066', 'home', 1, false),
  ('m067', 'home', 1, false),
  ('m068', 'home', 1, false),
  ('m069', 'home', 1, false),
  ('m070', 'home', 1, false),
  ('m071', 'home', 1, false),
  ('m072', 'home', 1, false),
  ('m073', 'home', 1, false),
  ('m074', 'home', 1, false),
  ('m075', 'home', 1, false),
  ('m076', 'water', 1, false),
  ('m077', 'water', 2, false),
  ('m078', 'water', 3, false),
  ('m079', 'water', 4, false),
  ('m080', 'water', 1, false),
  ('m081', 'water', 2, false),
  ('m082', 'water', 3, false),
  ('m083', 'water', 5, false),
  ('m084', 'water', 2, false),
  ('m085', 'water', 3, false),
  ('m086', 'water', 2, false),
  ('m087', 'water', 4, false),
  ('m088', 'beer_type', 2, false),
  ('m089', 'beer_type', 3, false),
  ('m090', 'beer_type', 2, false),
  ('m091', 'beer_type', 2, false),
  ('m092', 'beer_type', 2, false),
  ('m093', 'beer_type', 3, false),
  ('m094', 'beer_type', 2, false),
  ('m095', 'beer_type', 2, false),
  ('m096', 'beer_type', 2, false),
  ('m097', 'beer_type', 3, false),
  ('m098', 'queue_report', 1, false),
  ('m099', 'queue_report', 2, false),
  ('m100', 'queue_report', 1, false),
  ('m101', 'queue_report', 3, false),
  ('m102', 'queue_report', 1, false),
  ('m103', 'queue_report', 2, false),
  ('m104', 'queue_report', 1, false),
  ('m105', 'queue_report', 2, false),
  ('m106', 'tip', 1, true),
  ('m107', 'tip', 1, true),
  ('m108', 'tip', 2, true),
  ('m109', 'tip', 1, true),
  ('m110', 'tip', 1, true),
  ('m111', 'tip', 1, true),
  ('m112', 'tip', 3, true),
  ('m113', 'tip', 1, true),
  ('m114', 'early', 1, false),
  ('m115', 'early', 1, false),
  ('m116', 'early', 1, false),
  ('m117', 'early', 1, false),
  ('m118', 'early', 1, false),
  ('m119', 'early', 1, false),
  ('m120', 'early', 1, false),
  ('m121', 'early', 1, false),
  ('m122', 'other_none', 1, false),
  ('m123', 'other_none', 1, false),
  ('m124', 'other_none', 1, false),
  ('m125', 'other_none', 1, false),
  ('m126', 'other_none', 1, false),
  ('m127', 'other_none', 1, false),
  ('m128', 'other_none', 1, false),
  ('m129', 'other_none', 1, false)
on conflict (id) do update
   set kind = excluded.kind, goal = excluded.goal, needs_group = excluded.needs_group, active = true;

-- ---------------------------------------------------------------------------
-- 2. Helpers (internal, not callable by clients)
-- ---------------------------------------------------------------------------

-- The night before p_night (local calendar arithmetic, DST-correct).
create or replace function public.olnu_g_prev(p_night timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select ((p_night at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$$;

-- Stable opaque key for a member inside one group (never the user id).
create or replace function public.olnu_g_key(p_group uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-game'), 1, 12);
$$;

-- Out right now: a visible live pin (not stopped, so ghost pins never count) or a live check-in.
create or replace function public.olnu_g_live(p_uid uuid, p_night timestamptz, p_now timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select p_now < p_night and (
    exists (select 1 from public.beers b
             where b.user_id = p_uid and b.expires_at = p_night and not b.stopped
               and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1))
    or exists (select 1 from public.checkins c where c.user_id = p_uid and c.expires_at = p_night));
$$;

-- Has been out tonight (any beer / other drink logged, ghost too, or a check-in).
create or replace function public.olnu_g_outtonight(p_uid uuid, p_night timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.medal_nights mn
                  where mn.user_id = p_uid and mn.night = p_night and (mn.beers >= 1 or mn.others >= 1))
      or exists (select 1 from public.beers b
                  where b.user_id = p_uid and b.expires_at = p_night and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1))
      or exists (select 1 from public.checkins c where c.user_id = p_uid and c.expires_at = p_night)
      or exists (select 1 from public.medal_checkins m where m.user_id = p_uid and m.night = p_night);
$$;

-- Beers logged tonight within 20 km of a point (anonymous heat events; undone and ghost beers excluded).
create or replace function public.olnu_g_real(p_night timestamptz, p_lat float8, p_lng float8)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.beer_events e
   where e.kind = 'beer' and not e.undone and e.expires_at = p_night
     and e.lat between p_lat - 0.19 and p_lat + 0.19
     and e.lng between p_lng - 0.56 and p_lng + 0.56
     and public.olnu_dist_m(p_lat, p_lng, e.lat, e.lng) <= 20000;
$$;

-- Number of bingo lines (rows, columns, diagonals) in a set of ticked squares 0-8.
create or replace function public.olnu_g_lines(p_t int[])
returns int language sql immutable set search_path = public as $$
  select count(*)::int from (values (array[0,1,2]), (array[3,4,5]), (array[6,7,8]), (array[0,3,6]),
                                    (array[1,4,7]), (array[2,5,8]), (array[0,4,8]), (array[2,4,6])) l(a)
   where l.a <@ coalesce(p_t, '{}'::int[]);
$$;

create or replace function public.olnu_g_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$$;

-- ---------------------------------------------------------------------------
-- 3. Missions
-- ---------------------------------------------------------------------------

-- Progress of one mission kind tonight, from server facts only. Never counts beers drunk.
create or replace function public.olnu_g_progress(p_uid uuid, p_night timestamptz, p_kind text, p_now timestamptz)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v      int := 0;
  v_from timestamptz := p_night - interval '30 hours';
  v_eve  timestamp := public.olnu_evening(p_night)::timestamp;
  v_beers int; v_others int; v_first timestamptz; v_home timestamptz;
begin
  begin
    if p_kind = 'checkin_bars' then
      select count(distinct c.bar_id) into v from public.medal_checkins c where c.user_id = p_uid and c.night = p_night;
    elsif p_kind = 'skal_give' then
      select count(*) into v from public.skals s
       where s.user_id = p_uid and s.created_at > v_from and public.olnu_night_of(s.created_at) = p_night;
    elsif p_kind = 'skal_get' then
      select count(distinct s.user_id) into v from public.skals s join public.beers b on b.id = s.beer_id
       where b.user_id = p_uid and b.expires_at = p_night and s.user_id <> p_uid;
    elsif p_kind = 'chat' then
      select count(*) into v from public.group_msgs m
       where m.user_id = p_uid and m.created_at > v_from and public.olnu_night_of(m.created_at) = p_night;
    elsif p_kind = 'rally_yes' then
      select count(*) into v from public.rally_answers a join public.rallies r on r.id = a.rally_id
       where a.user_id = p_uid and a.answer = 'yes' and r.user_id <> p_uid and r.expires_at = p_night;
    elsif p_kind = 'group_out' then
      select coalesce(max(x.n), 0) into v from (
        select gm.group_id, count(*) filter (where public.olnu_g_live(o.user_id, p_night, p_now)) as n
          from public.group_members gm join public.group_members o on o.group_id = gm.group_id
         where gm.user_id = p_uid
         group by gm.group_id) x;
    elsif p_kind = 'water' then
      select coalesce(max(f.water), 0) into v from public.game_facts f where f.user_id = p_uid and f.night = p_night;
    elsif p_kind = 'beer_type' then
      select count(distinct t.type) into v from public.beer_types t
       where t.user_id = p_uid and t.night = p_night and t.type <> 'annan';
    elsif p_kind = 'queue_report' then
      select count(*) into v from public.bar_queue q
       where q.user_id = p_uid and q.created_at > v_from and public.olnu_night_of(q.created_at) = p_night;
    elsif p_kind = 'tip' then
      select count(*) into v from public.bar_tips t
       where t.user_id = p_uid and t.created_at > v_from and public.olnu_night_of(t.created_at) = p_night;
    elsif p_kind in ('home', 'early', 'other_none') then
      select mn.beers, mn.others, mn.first_at into v_beers, v_others, v_first
        from public.medal_nights mn where mn.user_id = p_uid and mn.night = p_night;
      select f.home_at into v_home from public.game_facts f where f.user_id = p_uid and f.night = p_night;
      if p_kind = 'home' then
        -- "Jag är hemma" after the first beer and before 02:00 (local wall clock).
        if coalesce(v_beers, 0) >= 1 and v_first is not null and v_home is not null and v_home >= v_first
           and (v_home at time zone 'Europe/Stockholm') < (p_night at time zone 'Europe/Stockholm') - interval '3 hours' then
          v := 1;
        end if;
      elsif p_kind = 'early' then
        if coalesce(v_beers, 0) >= 1 and v_first is not null
           and (v_first at time zone 'Europe/Stockholm') < v_eve + interval '20 hours' then
          v := 1;
        end if;
      else
        -- Only beer tonight: checked from 23:00 (or after "Jag är hemma").
        if coalesce(v_beers, 0) >= 1 and coalesce(v_others, 0) = 0
           and ((p_now at time zone 'Europe/Stockholm') >= v_eve + interval '23 hours' or v_home is not null) then
          v := 1;
        end if;
      end if;
    end if;
  exception when others then
    v := 0;
  end;
  return coalesce(v, 0);
end;
$$;

-- Give the 3 missions of a night once (deterministic from user + night; stored, so a reload never
-- changes them). 3 different kinds. Group missions only for users in a group. "early" is not given
-- from 19:00 and "home" not from 01:00 (too late to do them).
create or replace function public.olnu_g_assign(p_uid uuid, p_night timestamptz, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group boolean := exists (select 1 from public.group_members m where m.user_id = p_uid);
  v_h     int := extract(hour from (p_now at time zone 'Europe/Stockholm'))::int;
  v_seed  text := p_uid::text || ':' || (extract(epoch from p_night)::bigint)::text;
begin
  if exists (select 1 from public.game_missions gm where gm.user_id = p_uid and gm.night = p_night) then
    return;
  end if;
  insert into public.game_missions (user_id, night, slot, mission, kind, goal)
  select p_uid, p_night, x.rn, x.id, x.kind, x.goal from (
    select y.id, y.kind, y.goal, row_number() over (order by y.h) as rn from (
      select distinct on (c.kind) c.id, c.kind, c.goal, md5(v_seed || ':' || c.id) as h
        from public.game_mission_cat c
       where c.active and (v_group or not c.needs_group)
         and not (c.kind = 'early' and (v_h >= 19 or v_h < 5))
         and not (c.kind = 'home' and v_h >= 1 and v_h < 5)
       order by c.kind, md5(v_seed || ':' || c.id)) y) x
   where x.rn <= 3
  on conflict do nothing;
end;
$$;

-- The caller's own game state tonight (missions with progress, guess, sugen, agent missions).
create or replace function public.olnu_g_me(p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_prev  timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_close timestamptz := (public.olnu_evening(public.olnu_night_of(p_now))::timestamp + interval '21 hours') at time zone 'Europe/Stockholm';
  r record;
  v_p int;
  v_m jsonb := '[]'::jsonb;
  v_done int := 0;
  v_fresh boolean;
  v_guess jsonb := null;
  v_gprev jsonb := null;
  v_g record;
  v_real int;
  v_f record;
  v_sugen text;
  v_agents jsonb;
  v_tlat float8; v_tlng float8;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  perform public.olnu_g_assign(p_uid, v_night, p_now);
  for r in select * from public.game_missions gm where gm.user_id = p_uid and gm.night = v_night order by gm.slot loop
    v_fresh := false;
    if r.done_at is null then
      v_p := least(r.goal, public.olnu_g_progress(p_uid, v_night, r.kind, p_now));
      if v_p >= r.goal then
        update public.game_missions gm set progress = v_p, done_at = p_now
         where gm.user_id = p_uid and gm.night = v_night and gm.slot = r.slot and gm.done_at is null;
        v_fresh := true;
        r.done_at := p_now;
      elsif v_p <> r.progress then
        update public.game_missions gm set progress = v_p
         where gm.user_id = p_uid and gm.night = v_night and gm.slot = r.slot;
      end if;
    else
      v_p := r.goal;
    end if;
    if r.done_at is not null then v_done := v_done + 1; end if;
    v_m := v_m || jsonb_build_object('slot', r.slot, 'id', r.mission, 'kind', r.kind, 'goal', r.goal,
      'progress', v_p, 'done', r.done_at is not null, 'fresh', v_fresh, 'done_at', r.done_at);
  end loop;

  select * into v_g from public.game_guesses g where g.user_id = p_uid and g.night = v_night;
  if found then
    v_guess := jsonb_build_object('guess', v_g.guess, 'town', v_g.town);
    v_tlat := v_g.lat; v_tlng := v_g.lng;
  end if;
  select * into v_g from public.game_guesses g where g.user_id = p_uid and g.night = v_prev;
  if found then
    v_real := v_g.real;
    if v_real is null then
      v_real := public.olnu_g_real(v_prev, v_g.lat, v_g.lng);
      update public.game_guesses g set real = v_real where g.user_id = p_uid and g.night = v_prev and g.real is null;
    end if;
    v_gprev := jsonb_build_object('guess', v_g.guess, 'town', v_g.town, 'real', v_real);
  end if;

  select f.water, f.home_at into v_f from public.game_facts f where f.user_id = p_uid and f.night = v_night;
  select s.status into v_sugen from public.game_sugen s where s.user_id = p_uid and s.night = v_night;

  select coalesce(jsonb_agg(jsonb_build_object('group_id', a.group_id, 'group_name', g.name, 'mission', a.mission)), '[]'::jsonb)
    into v_agents
    from public.game_agents a join public.groups g on g.id = a.group_id
   where a.agent = p_uid and a.night = v_night
     and exists (select 1 from public.group_members m where m.group_id = a.group_id and m.user_id = p_uid);

  return jsonb_build_object(
    'night', v_night, 'missions', v_m, 'done_n', v_done,
    'water', coalesce(v_f.water, 0), 'home_at', v_f.home_at,
    'guess', v_guess, 'guess_open', p_now < v_close, 'guess_closes', v_close,
    'guess_so_far', case when p_now >= v_close and v_guess is not null
                         then public.olnu_g_real(v_night, v_tlat, v_tlng) end,
    'guess_prev', v_gprev,
    'sugen', case when v_sugen = 'none' then null else v_sugen end,
    'out', public.olnu_g_outtonight(p_uid, v_night),
    'agent', v_agents);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Group games: lazy end-of-night steps (idempotent)
-- ---------------------------------------------------------------------------

-- Hemlig agent: reveal after 05:00 when every member except the agent has voted, or at 12:00 local.
create or replace function public.olnu_g_reveal(p_group uuid, p_night timestamptz, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.game_agents a
     set revealed_at = p_now,
         correct = (select count(*) from public.game_agent_votes v
                     where v.group_id = a.group_id and v.night = a.night and v.suspect = a.agent),
         votes = (select count(*) from public.game_agent_votes v where v.group_id = a.group_id and v.night = a.night)
   where a.group_id = p_group and a.night = p_night and a.revealed_at is null and p_now >= p_night
     and (p_now >= ((p_night at time zone 'Europe/Stockholm') + interval '7 hours') at time zone 'Europe/Stockholm'
          or (select count(*) from public.game_agent_votes v where v.group_id = a.group_id and v.night = a.night)
             >= (select count(*) from public.group_members m where m.group_id = p_group and m.user_id <> a.agent));
end;
$$;

-- Gissa kvällen: the best guess of a finished night in one group (needs 2+ guesses by current members).
create or replace function public.olnu_g_oracle(p_group uuid, p_night timestamptz, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_now < p_night or exists (select 1 from public.game_oracles o where o.group_id = p_group and o.night = p_night) then
    return;
  end if;
  update public.game_guesses g set real = public.olnu_g_real(g.night, g.lat, g.lng)
   where g.night = p_night and g.real is null
     and g.user_id in (select m.user_id from public.group_members m where m.group_id = p_group);
  insert into public.game_oracles (group_id, night, user_id, guess, real, err, guessers)
  select p_group, p_night, x.user_id, x.guess, x.real, x.err, x.cnt from (
    select g.user_id, g.guess, g.real, g.created_at,
           abs(g.guess - g.real)::float8 / greatest(g.real, 1) as err,
           count(*) over () as cnt
      from public.game_guesses g
      join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = p_night and g.real is not null) x
   where x.cnt >= 2
   order by x.err, x.created_at, x.user_id
   limit 1
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Group state (one group). p_full = the group sheet; else a compact summary for the poll.
-- ---------------------------------------------------------------------------
create or replace function public.olnu_g_group(p_uid uuid, p_group uuid, p_now timestamptz,
                                               p_full boolean default false, p_bingo_n int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_prev  timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_out   jsonb := '{}'::jsonb;
  v_j     jsonb;
  v_c     record;
  v_stops jsonb;
  v_dn    int;
  v_card  record;
  v_t     int[];
  v_ticks jsonb;
  v_a     record;
  v_n     int;
  v_bn    int := greatest(9, least(400, coalesce(p_bingo_n, 40)));
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;

  -- Sugen-status tonight (visible members only; "out" = visible pin or check-in right now).
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = p_uid, 'status', s.status, 'at', s.updated_at,
           'out', public.olnu_g_live(m.user_id, v_night, p_now)) order by s.updated_at desc), '[]'::jsonb)
    into v_j
    from public.group_members m
    join public.game_sugen s on s.user_id = m.user_id and s.night = v_night and s.status <> 'none'
   where m.group_id = p_group;
  v_out := v_out || jsonb_build_object('sugen', v_j);

  -- Krogrunda: the newest open route tonight. A stop is done when a member checked in there tonight.
  select * into v_c from public.game_crawls c
   where c.group_id = p_group and c.night = v_night and not c.closed order by c.id desc limit 1;
  if found then
    select jsonb_agg(jsonb_build_object('i', s.ord - 1, 'id', s.v->>'id', 'name', s.v->>'name',
             'lat', (s.v->>'lat')::float8, 'lng', (s.v->>'lng')::float8, 'done', w.names is not null,
             'who', case when p_full then w.names end) order by s.ord),
           count(*) filter (where w.names is not null)
      into v_stops, v_dn
      from jsonb_array_elements(v_c.stops) with ordinality s(v, ord)
      left join lateral (
        select jsonb_agg(m.display_name order by m.display_name) as names
          from public.group_members m
          join public.medal_checkins mc on mc.user_id = m.user_id and mc.night = v_night and mc.bar_id = s.v->>'id'
         where m.group_id = p_group) w on true;
    if v_dn >= v_c.n and v_c.done_at is null then
      update public.game_crawls c set done_at = p_now where c.id = v_c.id and c.done_at is null;
      v_c.done_at := p_now;
    end if;
    v_out := v_out || jsonb_build_object('crawl', jsonb_build_object(
      'id', v_c.id, 'n', v_c.n, 'done_n', v_dn, 'done', v_c.done_at is not null, 'done_at', v_c.done_at,
      'is_mine', v_c.user_id = p_uid, 'created_at', v_c.created_at,
      'by', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_c.user_id),
      'stops', v_stops));
  else
    v_out := v_out || jsonb_build_object('crawl', null);
  end if;

  -- Kvällsbingo: the group sheet makes tonight's card (9 different square numbers below p_bingo_n).
  select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  if not found and p_full then
    insert into public.game_bingo_cards (group_id, night, card, n)
    select p_group, v_night, array_agg(z.x), v_bn
      from (select x from generate_series(0, v_bn - 1) x order by random() limit 9) z
    on conflict do nothing;
    select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  end if;
  if v_card.group_id is not null then
    select array_agg(t.idx::int order by t.idx),
           jsonb_agg(jsonb_build_object('idx', t.idx, 'name', m.display_name, 'is_me', t.user_id = p_uid) order by t.idx)
      into v_t, v_ticks
      from public.game_bingo_ticks t
      left join public.group_members m on m.group_id = p_group and m.user_id = t.user_id
     where t.group_id = p_group and t.night = v_night and t.ticked;
    v_out := v_out || jsonb_build_object('bingo', jsonb_build_object(
      'card', case when p_full then to_jsonb(v_card.card) end, 'n', v_card.n,
      'ticks', case when p_full then coalesce(v_ticks, '[]'::jsonb) else to_jsonb(coalesce(array_length(v_t, 1), 0)) end,
      'lines', public.olnu_g_lines(v_t), 'bingo_at', v_card.bingo_at));
  else
    v_out := v_out || jsonb_build_object('bingo', null);
  end if;

  -- Hemlig agent tonight. Only the agent sees the mission.
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_night;
  if found then
    v_out := v_out || jsonb_build_object('agent', jsonb_build_object(
      'active', true, 'is_me', v_a.agent = p_uid, 'mission', case when v_a.agent = p_uid then v_a.mission end,
      'by', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_a.started_by)));
  else
    v_out := v_out || jsonb_build_object('agent', null);
  end if;

  -- Hemlig agent last night: voting from 05:00, reveal when all voted or at 12:00.
  begin
    perform public.olnu_g_reveal(p_group, v_prev, p_now);
  exception when others then
    null;
  end;
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_prev;
  if found then
    select count(*) into v_n from public.game_agent_votes v where v.group_id = p_group and v.night = v_prev;
    v_j := jsonb_build_object(
      'revealed', v_a.revealed_at is not null, 'voting', v_a.revealed_at is null,
      'reveal_at', ((v_prev at time zone 'Europe/Stockholm') + interval '7 hours') at time zone 'Europe/Stockholm',
      'votes', v_n,
      'needed', (select count(*) from public.group_members m where m.group_id = p_group and m.user_id <> v_a.agent),
      'is_agent', v_a.agent = p_uid,
      'my_vote', (select public.olnu_g_key(p_group, v.suspect) from public.game_agent_votes v
                   where v.group_id = p_group and v.night = v_prev and v.voter = p_uid),
      'mission', case when v_a.revealed_at is not null or v_a.agent = p_uid then v_a.mission end);
    if v_a.revealed_at is not null then
      v_j := v_j || jsonb_build_object(
        'agent_name', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_a.agent),
        'agent_k', public.olnu_g_key(p_group, v_a.agent), 'correct', coalesce(v_a.correct, 0),
        'correct_names', (select coalesce(jsonb_agg(m.display_name order by v.created_at), '[]'::jsonb)
                            from public.game_agent_votes v
                            join public.group_members m on m.group_id = p_group and m.user_id = v.voter
                           where v.group_id = p_group and v.night = v_prev and v.suspect = v_a.agent),
        'i_was_right', exists (select 1 from public.game_agent_votes v where v.group_id = p_group and v.night = v_prev
                                 and v.voter = p_uid and v.suspect = v_a.agent));
    end if;
    v_out := v_out || jsonb_build_object('agent_prev', v_j);
  else
    v_out := v_out || jsonb_build_object('agent_prev', null);
  end if;

  -- Gissa kvällen: "Dagens orakel" = best guess last night.
  begin
    perform public.olnu_g_oracle(p_group, v_prev, p_now);
  exception when others then
    null;
  end;
  select o.*, m.display_name into v_a from public.game_oracles o
    left join public.group_members m on m.group_id = p_group and m.user_id = o.user_id
   where o.group_id = p_group and o.night = v_prev;
  if found then
    v_out := v_out || jsonb_build_object('oracle', jsonb_build_object(
      'name', v_a.display_name, 'is_me', v_a.user_id = p_uid, 'guess', v_a.guess, 'real', v_a.real,
      'err', round(v_a.err::numeric, 3), 'guessers', v_a.guessers));
  else
    v_out := v_out || jsonb_build_object('oracle', null);
  end if;

  if p_full then
    -- Members (key for the agent vote), points, guesses.
    select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group, m.user_id), 'name', m.display_name,
             'is_me', m.user_id = p_uid, 'out', public.olnu_g_live(m.user_id, v_night, p_now)) order by m.joined_at), '[]'::jsonb)
      into v_j from public.group_members m where m.group_id = p_group;
    v_out := v_out || jsonb_build_object('members', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'is_me', x.is_me, 'pts', x.pts) order by x.pts desc, x.name), '[]'::jsonb)
      into v_j
      from (select m.display_name as name, m.user_id = p_uid as is_me,
                   (select count(*) from public.game_agent_votes v
                      join public.game_agents a on a.group_id = v.group_id and a.night = v.night
                     where v.group_id = p_group and v.voter = m.user_id and v.suspect = a.agent and a.revealed_at is not null)
                   + 2 * (select count(*) from public.game_agents a
                           where a.group_id = p_group and a.agent = m.user_id and a.revealed_at is not null
                             and coalesce(a.correct, 0) = 0 and coalesce(a.votes, 0) >= 1) as pts
              from public.group_members m where m.group_id = p_group) x
     where x.pts > 0;
    v_out := v_out || jsonb_build_object('points', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'is_me', m.user_id = p_uid,
             'guess', g.guess, 'real', g.real, 'town', g.town) order by abs(g.guess - coalesce(g.real, 0))), '[]'::jsonb)
      into v_j
      from public.game_guesses g join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = v_prev;
    v_out := v_out || jsonb_build_object('guesses_prev', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'is_me', m.user_id = p_uid) order by g.created_at), '[]'::jsonb)
      into v_j
      from public.game_guesses g join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = v_night;
    v_out := v_out || jsonb_build_object('guessed', v_j);
  end if;

  return v_out || jsonb_build_object('night', v_night);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Actions (internal versions take p_now; the RPCs below pass now())
-- ---------------------------------------------------------------------------

create or replace function public.olnu_g_water(p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_f record;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  insert into public.game_facts (user_id, night) values (p_uid, v_night) on conflict do nothing;
  select * into v_f from public.game_facts f where f.user_id = p_uid and f.night = v_night;
  if v_f.water_at is not null and v_f.water_at > p_now - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'water', v_f.water,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_f.water_at + interval '5 minutes' - p_now)))::int));
  end if;
  if v_f.water >= 10 then
    return jsonb_build_object('ok', false, 'water', v_f.water, 'wait_seconds', 0, 'reason', 'limit');
  end if;
  update public.game_facts f set water = f.water + 1, water_at = p_now where f.user_id = p_uid and f.night = v_night;
  return jsonb_build_object('ok', true, 'water', v_f.water + 1, 'wait_seconds', 0);
end;
$$;

-- "Jag är hemma": keeps the first press after tonight's first beer.
create or replace function public.olnu_g_home(p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_first timestamptz;
  v_home  timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select mn.first_at into v_first from public.medal_nights mn where mn.user_id = p_uid and mn.night = v_night;
  insert into public.game_facts as f (user_id, night, home_at) values (p_uid, v_night, p_now)
  on conflict (user_id, night) do update
     set home_at = case when f.home_at is null or (v_first is not null and f.home_at < v_first) then excluded.home_at
                        else f.home_at end
  returning f.home_at into v_home;
  return jsonb_build_object('ok', true, 'home_at', v_home);
end;
$$;

create or replace function public.olnu_g_sugen(p_uid uuid, p_status text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_s     text := lower(btrim(coalesce(p_status, '')));
  v_old   record;
begin
  if v_s = '' then v_s := 'none'; end if;
  if v_s not in ('sugen', 'kanske', 'inte', 'none') then
    raise exception 'invalid_status';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select * into v_old from public.game_sugen s where s.user_id = p_uid and s.night = v_night;
  if found then
    if v_old.status = v_s then
      return jsonb_build_object('status', case when v_s = 'none' then null else v_s end, 'changed', false);
    end if;
    if v_old.updated_at > p_now - interval '10 seconds' or v_old.changes >= 40 then
      raise exception 'slow_down';
    end if;
  end if;
  insert into public.game_sugen as s (user_id, night, status, updated_at) values (p_uid, v_night, v_s, p_now)
  on conflict (user_id, night) do update set status = excluded.status, updated_at = excluded.updated_at, changes = s.changes + 1;
  return jsonb_build_object('status', case when v_s = 'none' then null else v_s end, 'changed', true);
end;
$$;

create or replace function public.olnu_g_crawl(p_uid uuid, p_group uuid, p_stops jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_stops jsonb;
  v_n int; v_ids int; v_bad int;
  v_id bigint;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) not between 2 and 6 then
    raise exception 'invalid_crawl';
  end if;
  begin
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'lat', round(x.lat::numeric, 5)::float8,
             'lng', round(x.lng::numeric, 5)::float8) order by x.ord),
           count(*), count(distinct x.id),
           count(*) filter (where x.id is null or char_length(x.id) not between 1 and 80
                              or x.name is null or char_length(x.name) not between 1 and 60
                              or x.lat is null or x.lng is null
                              or x.lat not between 55.0 and 69.1 or x.lng not between 10.9 and 24.2)
      into v_stops, v_n, v_ids, v_bad
      from (select e.ord,
                   btrim(e.v->>'id') as id,
                   btrim(regexp_replace(regexp_replace(coalesce(e.v->>'name', ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')) as name,
                   (e.v->>'lat')::float8 as lat, (e.v->>'lng')::float8 as lng
              from jsonb_array_elements(p_stops) with ordinality e(v, ord)) x;
  exception when others then
    raise exception 'invalid_crawl';
  end;
  if v_bad > 0 or v_ids <> v_n then
    raise exception 'invalid_crawl';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  if exists (select 1 from public.game_crawls c where c.user_id = p_uid and c.created_at > p_now - interval '2 minutes'
                                                  and c.created_at <= p_now) then
    raise exception 'slow_down';
  end if;
  update public.game_crawls c set closed = true where c.group_id = p_group and c.night = v_night and not c.closed;
  insert into public.game_crawls (group_id, user_id, night, stops, n, created_at)
  values (p_group, p_uid, v_night, v_stops, v_n, p_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'n', v_n);
end;
$$;

create or replace function public.olnu_g_start_agent(p_uid uuid, p_group uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_a     record;
  v_agent uuid;
  v_out   int;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_agent:' || p_group::text, 0));
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_night;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'is_me', v_a.agent = p_uid);
  end if;
  if (select count(*) from public.group_members m where m.group_id = p_group) < 3 then
    raise exception 'not_enough';
  end if;
  select count(*) into v_out from public.group_members m
   where m.group_id = p_group and public.olnu_g_outtonight(m.user_id, v_night);
  if v_out < 2 then
    raise exception 'not_enough';
  end if;
  select m.user_id into v_agent from public.group_members m
   where m.group_id = p_group and public.olnu_g_outtonight(m.user_id, v_night)
   order by random() limit 1;
  insert into public.game_agents (group_id, night, agent, mission, started_by, created_at)
  values (p_group, v_night, v_agent, floor(random() * 1000)::int, p_uid, p_now)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'already', false, 'is_me', v_agent = p_uid);
end;
$$;

create or replace function public.olnu_g_vote(p_uid uuid, p_group uuid, p_member text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_a    record;
  v_s    uuid;
  v_new  boolean;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_agent:' || p_group::text, 0));
  perform public.olnu_g_reveal(p_group, v_prev, p_now);
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_prev;
  if not found or v_a.revealed_at is not null then
    raise exception 'no_agent';
  end if;
  if v_a.agent = p_uid then
    raise exception 'is_agent';
  end if;
  select m.user_id into v_s from public.group_members m
   where m.group_id = p_group and public.olnu_g_key(p_group, m.user_id) = btrim(coalesce(p_member, ''));
  if v_s is null or v_s = p_uid then
    raise exception 'invalid_suspect';
  end if;
  insert into public.game_agent_votes (group_id, night, voter, suspect, created_at)
  values (p_group, v_prev, p_uid, v_s, p_now)
  on conflict do nothing;
  v_new := found;
  perform public.olnu_g_reveal(p_group, v_prev, p_now);
  return jsonb_build_object('ok', true, 'already', not v_new,
    'revealed', exists (select 1 from public.game_agents a where a.group_id = p_group and a.night = v_prev and a.revealed_at is not null));
end;
$$;

create or replace function public.olnu_g_tick(p_uid uuid, p_group uuid, p_idx int, p_on boolean, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_card  record;
  v_t     record;
  v_ch    int;
  v_arr   int[];
  v_lines int;
  v_new   boolean := false;
  v_on    boolean := coalesce(p_on, true);
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  if p_idx is null or p_idx not between 0 and 8 then
    raise exception 'invalid_idx';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_bingo:' || p_group::text, 0));
  select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  if not found then
    raise exception 'no_card';
  end if;
  select * into v_t from public.game_bingo_ticks t where t.group_id = p_group and t.night = v_night and t.idx = p_idx;
  if (v_on and coalesce(v_t.ticked, false)) or (not v_on and not coalesce(v_t.ticked, false)) then
    null;   -- nothing to change
  else
    if not v_on and v_t.user_id <> p_uid then
      raise exception 'not_yours';
    end if;
    select f.bingo_changes into v_ch from public.game_facts f where f.user_id = p_uid and f.night = v_night;
    if coalesce(v_ch, 0) >= 100 then
      raise exception 'slow_down';
    end if;
    insert into public.game_facts as f (user_id, night, bingo_changes) values (p_uid, v_night, 1)
    on conflict (user_id, night) do update set bingo_changes = f.bingo_changes + 1;
    insert into public.game_bingo_ticks as t (group_id, night, idx, user_id, ticked, updated_at)
    values (p_group, v_night, p_idx, p_uid, v_on, p_now)
    on conflict (group_id, night, idx) do update set user_id = excluded.user_id, ticked = excluded.ticked, updated_at = excluded.updated_at;
  end if;
  select array_agg(t.idx::int order by t.idx) into v_arr from public.game_bingo_ticks t
   where t.group_id = p_group and t.night = v_night and t.ticked;
  v_lines := public.olnu_g_lines(v_arr);
  if v_lines > v_card.lines then
    update public.game_bingo_cards b set lines = v_lines, bingo_at = coalesce(b.bingo_at, p_now)
     where b.group_id = p_group and b.night = v_night;
    v_new := true;
  end if;
  return jsonb_build_object('ok', true, 'ticked', to_jsonb(coalesce(v_arr, '{}'::int[])), 'lines', v_lines, 'new_bingo', v_new);
end;
$$;

create or replace function public.olnu_g_guess(p_uid uuid, p_guess int, p_town text, p_lat float8, p_lng float8, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_close timestamptz := (public.olnu_evening(public.olnu_night_of(p_now))::timestamp + interval '21 hours') at time zone 'Europe/Stockholm';
  v_town  text := left(btrim(regexp_replace(regexp_replace(coalesce(p_town, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), 40);
  v_ch    int;
begin
  if p_now >= v_close then
    raise exception 'too_late';
  end if;
  if p_guess is null or p_guess not between 0 and 20000 then
    raise exception 'invalid_guess';
  end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng
     or p_lat not between 55.0 and 69.1 or p_lng not between 10.9 and 24.2 then
    raise exception 'outside_sweden';
  end if;
  if v_town = '' then v_town := 'Närområdet'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select g.changes into v_ch from public.game_guesses g where g.user_id = p_uid and g.night = v_night;
  if coalesce(v_ch, 0) >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.game_guesses as g (user_id, night, guess, town, lat, lng, created_at, updated_at)
  values (p_uid, v_night, p_guess, v_town, round(p_lat::numeric, 2)::float8, round(p_lng::numeric, 2)::float8, p_now, p_now)
  on conflict (user_id, night) do update
     set guess = excluded.guess, town = excluded.town, lat = excluded.lat, lng = excluded.lng,
         updated_at = excluded.updated_at, changes = g.changes + 1;
  return jsonb_build_object('ok', true, 'guess', p_guess, 'town', v_town, 'closes_at', v_close);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPCs (authenticated only; not_authenticated without a session)
-- ---------------------------------------------------------------------------

-- game_poll() -> jsonb {v, server_time, night, me, groups:[summary + id, name]} (max 20 groups).
create or replace function public.game_poll()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := now();
  v_me  jsonb;
  v_gs  jsonb;
begin
  v_me := public.olnu_g_me(v_uid, v_now);
  select coalesce(jsonb_agg(public.olnu_g_group(v_uid, x.id, v_now, false, null)
                            || jsonb_build_object('id', x.id, 'name', x.name) order by x.created_at), '[]'::jsonb)
    into v_gs
    from (select g.id, g.name, g.created_at from public.groups g
            join public.group_members m on m.group_id = g.id and m.user_id = v_uid
           order by g.created_at limit 20) x;
  return jsonb_build_object('v', 1, 'server_time', v_now, 'night', public.olnu_night_of(v_now), 'me', v_me, 'groups', v_gs);
end;
$$;

-- game_group(p_group_id, p_bingo_n default 40) -> jsonb, full state for the group sheet. Error: not_member.
create or replace function public.game_group(p_group_id uuid, p_bingo_n int default 40)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return public.olnu_g_group(v_uid, p_group_id, now(), true, p_bingo_n)
      || jsonb_build_object('id', p_group_id, 'name', (select g.name from public.groups g where g.id = p_group_id));
end;
$$;

create or replace function public.game_water()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_water(v_uid, now()); end; $$;

create or replace function public.game_home()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_home(v_uid, now()); end; $$;

create or replace function public.set_sugen(p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_sugen(v_uid, p_status, now()); end; $$;

create or replace function public.create_crawl(p_group_id uuid, p_stops jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_crawl(v_uid, p_group_id, p_stops, now()); end; $$;

-- close_crawl(p_crawl_id): the creator ends tonight's route. Error: crawl_not_found.
create or replace function public.close_crawl(p_crawl_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  update public.game_crawls c set closed = true
   where c.id = p_crawl_id and c.user_id = v_uid and c.night = public.olnu_night_of(now());
  if not found then
    raise exception 'crawl_not_found';
  end if;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.start_agent(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_start_agent(v_uid, p_group_id, now()); end; $$;

create or replace function public.vote_agent(p_group_id uuid, p_member text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_vote(v_uid, p_group_id, p_member, now()); end; $$;

create or replace function public.tick_bingo(p_group_id uuid, p_idx int, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_tick(v_uid, p_group_id, p_idx, p_on, now()); end; $$;

create or replace function public.guess_night(p_guess int, p_town text, p_lat float8, p_lng float8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_guess(v_uid, p_guess, p_town, p_lat, p_lng, now()); end; $$;

-- ---------------------------------------------------------------------------
-- 8. Medals
--    uppdrag   Uppdragstagaren   missions done (stacks)
--    uppdrag3  Fullt pådrag      nights with 3 of 3 missions (stacks)
--    runda     Rundvandraren     finished pub crawls with 2+ own stops (stacks)
--    detektiv  Detektiven        correct guesses of the secret agent (stacks)
--    spion     Mästerspionen     agent and nobody guessed right (needs 1+ vote; stacks)
--    orakel    Oraklet           best "Gissa kvällen" guess in a group (stacks)
--    bingo     Bingo!            nights where a group card got a line and you ticked a square (stacks)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_medal_eval_games(p_uid uuid)
returns table (medal text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_m int := 0; v_m3 int := 0; v_r int := 0; v_d int := 0; v_s int := 0; v_o int := 0; v_b int := 0;
begin
  begin
    select count(*) into v_m from public.game_missions gm where gm.user_id = p_uid and gm.done_at is not null;
    select count(*) into v_m3 from (
      select gm.night from public.game_missions gm where gm.user_id = p_uid and gm.done_at is not null
       group by gm.night having count(*) >= 3) x;
    select count(*) into v_r from public.game_crawls k
     where k.done_at is not null
       and k.group_id in (select m.group_id from public.group_members m where m.user_id = p_uid)
       and (select count(*) from jsonb_array_elements(k.stops) s
             where exists (select 1 from public.medal_checkins mc
                            where mc.user_id = p_uid and mc.night = k.night and mc.bar_id = s->>'id')) >= 2;
    select count(*) into v_d from public.game_agent_votes v
      join public.game_agents a on a.group_id = v.group_id and a.night = v.night
     where v.voter = p_uid and v.suspect = a.agent and a.revealed_at is not null;
    select count(*) into v_s from public.game_agents a
     where a.agent = p_uid and a.revealed_at is not null and coalesce(a.correct, 0) = 0 and coalesce(a.votes, 0) >= 1;
    select count(*) into v_o from public.game_oracles o where o.user_id = p_uid;
    select count(distinct c.night) into v_b from public.game_bingo_cards c
     where c.bingo_at is not null
       and exists (select 1 from public.game_bingo_ticks t
                    where t.group_id = c.group_id and t.night = c.night and t.user_id = p_uid and t.ticked);
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('uppdrag', v_m), ('uppdrag3', v_m3), ('runda', v_r), ('detektiv', v_d),
    ('spion', v_s), ('orakel', v_o), ('bingo', v_b)
  ) as v(medal, n);
end;
$$;

-- Same name and return type as 0012/0014. Byte-for-byte the same body as in 0018_after.sql, so the
-- order the two files run in does not matter. Unions EVERY public function named
-- olnu_medal_eval / olnu_medal_eval_<x>(uuid) returning (medal text, n int), so later
-- rounds only add an eval function and never need to touch this one again. Counts never go down.
create or replace function public.olnu_medal_store(p_uid uuid)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
begin
  select string_agg(format('select x.medal as m, x.n from public.%I($1) x', p.proname), ' union all ' order by p.proname)
    into v_sql
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname ~ '^olnu_medal_eval(_[a-z0-9]+)?$'
     and pg_get_function_identity_arguments(p.oid) = 'p_uid uuid'
     and pg_get_function_result(p.oid) = 'TABLE(medal text, n integer)';
  if v_sql is null then
    return;
  end if;
  return query execute
    'with ev as (' || v_sql || '),
     e as (select ev.m, max(ev.n)::int as n from ev where ev.n >= 1 group by ev.m),
     up as (
       insert into public.user_medals as um (user_id, medal, count, earned_at, updated_at)
       select $1, e.m, e.n, now(), now() from e
       on conflict on constraint user_medals_pkey do update
          set count = greatest(um.count, excluded.count), updated_at = now()
        where excluded.count > um.count
       returning um.medal, um.count, (um.earned_at = now()) as fresh, um.earned_at)
     select up.medal, up.count, up.fresh, up.earned_at from up'
  using p_uid;
end;
$$;

-- olnu_g_anonymize(old, new): moves every game row of a user to another (random) user id and blanks
-- what could point at a place. For "Radera allt om mig" (0016, the erase RPC): call
--   perform public.olnu_g_anonymize(v_uid, v_new);
-- next to the other anonymizing updates. Catches its own errors (a missing table never blocks the erase).
create or replace function public.olnu_g_anonymize(p_old uuid, p_new uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.game_missions g set user_id = p_new where g.user_id = p_old;
    update public.game_facts g set user_id = p_new where g.user_id = p_old;
    update public.game_sugen g set user_id = p_new, status = 'none' where g.user_id = p_old;
    update public.game_crawls g set user_id = p_new, closed = true where g.user_id = p_old;
    update public.game_agents g set agent = p_new where g.agent = p_old;
    update public.game_agents g set started_by = p_new where g.started_by = p_old;
    update public.game_agent_votes g set voter = p_new where g.voter = p_old;
    update public.game_agent_votes g set suspect = p_new where g.suspect = p_old;
    update public.game_guesses g set user_id = p_new, town = 'Närområdet', lat = 0, lng = 0 where g.user_id = p_old;
    update public.game_oracles g set user_id = p_new where g.user_id = p_old;
    update public.game_bingo_ticks g set user_id = p_new where g.user_id = p_old;
  exception when others then
    null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  fns text[] := array[
    'public.game_poll()',
    'public.game_group(uuid, integer)',
    'public.game_water()',
    'public.game_home()',
    'public.set_sugen(text)',
    'public.create_crawl(uuid, jsonb)',
    'public.close_crawl(bigint)',
    'public.start_agent(uuid)',
    'public.vote_agent(uuid, text)',
    'public.tick_bingo(uuid, integer, boolean)',
    'public.guess_night(integer, text, double precision, double precision)'
  ];
  internal text[] := array[
    'public.olnu_g_prev(timestamptz)',
    'public.olnu_g_key(uuid, uuid)',
    'public.olnu_g_live(uuid, timestamptz, timestamptz)',
    'public.olnu_g_outtonight(uuid, timestamptz)',
    'public.olnu_g_real(timestamptz, double precision, double precision)',
    'public.olnu_g_lines(integer[])',
    'public.olnu_g_member(uuid, uuid)',
    'public.olnu_g_progress(uuid, timestamptz, text, timestamptz)',
    'public.olnu_g_assign(uuid, timestamptz, timestamptz)',
    'public.olnu_g_me(uuid, timestamptz)',
    'public.olnu_g_reveal(uuid, timestamptz, timestamptz)',
    'public.olnu_g_oracle(uuid, timestamptz, timestamptz)',
    'public.olnu_g_group(uuid, uuid, timestamptz, boolean, integer)',
    'public.olnu_g_water(uuid, timestamptz)',
    'public.olnu_g_home(uuid, timestamptz)',
    'public.olnu_g_sugen(uuid, text, timestamptz)',
    'public.olnu_g_crawl(uuid, uuid, jsonb, timestamptz)',
    'public.olnu_g_start_agent(uuid, uuid, timestamptz)',
    'public.olnu_g_vote(uuid, uuid, text, timestamptz)',
    'public.olnu_g_tick(uuid, uuid, integer, boolean, timestamptz)',
    'public.olnu_g_guess(uuid, integer, text, double precision, double precision, timestamptz)',
    'public.olnu_medal_eval_games(uuid)',
    'public.olnu_g_anonymize(uuid, uuid)',
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

-- ===== 0019_chat_likes.sql =====
-- 0019 Chat likes (additive). A member can like any message in a group they are in (toggle).
-- msg_likes(p_group_id, p_after_id) returns like counts + who liked, for live messages.
create table if not exists public.group_msg_likes (
  msg_id     bigint not null,
  user_id    uuid   not null,
  liked      boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (msg_id, user_id)
);
alter table public.group_msg_likes enable row level security;
revoke all on public.group_msg_likes from anon, authenticated;

-- Toggle my like. Returns {likes, liked}. Errors: not_member, msg_not_found.
create or replace function public.like_msg(p_msg_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_gid uuid;
  v_liked boolean;
  v_n int;
begin
  select gm.group_id into v_gid from public.group_msgs gm where gm.id = p_msg_id and gm.expires_at > now();
  if v_gid is null then raise exception 'msg_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  insert into public.group_msg_likes as l (msg_id, user_id, liked) values (p_msg_id, v_uid, true)
  on conflict (msg_id, user_id) do update set liked = not l.liked, created_at = now()
  returning l.liked into v_liked;
  select count(*) into v_n from public.group_msg_likes where msg_id = p_msg_id and liked;
  return jsonb_build_object('likes', v_n, 'liked', v_liked);
end;
$$;

-- Likes for the live messages of a group (all, or with id > p_after_id - 200 to keep it small).
create or replace function public.msg_likes(p_group_id uuid)
returns table (msg_id bigint, likes int, liked bool, names text[])
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
  select l.msg_id, count(*)::int, bool_or(l.user_id = v_uid),
         array_agg(coalesce(mm.display_name, '?') order by l.created_at)
    from public.group_msg_likes l
    join public.group_msgs gm on gm.id = l.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = l.user_id
   where l.liked
   group by l.msg_id;
end;
$$;

revoke all on function public.like_msg(bigint) from public, anon;
revoke all on function public.msg_likes(uuid) from public, anon;
grant execute on function public.like_msg(bigint) to authenticated;
grant execute on function public.msg_likes(uuid) to authenticated;

-- ===== 0020_chat_reacts.sql =====
-- 0020 Chat reactions (additive). Long-press a message → 🍻 😂 🔥 ❤️. One reaction per user per message
-- (same emoji again = remove, other emoji = switch). 0019 like_msg/msg_likes stay for old app versions.
create table if not exists public.group_msg_reacts (
  msg_id     bigint not null,
  user_id    uuid   not null,
  emoji      text   not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (msg_id, user_id)
);
alter table public.group_msg_reacts enable row level security;
revoke all on public.group_msg_reacts from anon, authenticated;

create or replace function public.react_msg(p_msg_id bigint, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_gid uuid;
  v_old text;
  v_act boolean;
begin
  if p_emoji not in ('🍻','😂','🔥','❤️') then raise exception 'invalid_emoji'; end if;
  select gm.group_id into v_gid from public.group_msgs gm where gm.id = p_msg_id and gm.expires_at > now();
  if v_gid is null then raise exception 'msg_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select r.emoji, r.active into v_old, v_act from public.group_msg_reacts r where r.msg_id = p_msg_id and r.user_id = v_uid;
  if v_old is null then
    insert into public.group_msg_reacts (msg_id, user_id, emoji) values (p_msg_id, v_uid, p_emoji);
    return jsonb_build_object('emoji', p_emoji);
  elsif v_old = p_emoji and v_act then
    update public.group_msg_reacts set active = false, created_at = now() where msg_id = p_msg_id and user_id = v_uid;
    return jsonb_build_object('emoji', null);
  else
    update public.group_msg_reacts set emoji = p_emoji, active = true, created_at = now() where msg_id = p_msg_id and user_id = v_uid;
    return jsonb_build_object('emoji', p_emoji);
  end if;
end;
$$;

create or replace function public.msg_reacts(p_group_id uuid)
returns table (msg_id bigint, emoji text, n int, mine bool, names text[])
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
  select r.msg_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid),
         array_agg(coalesce(mm.display_name, '?') order by r.created_at)
    from public.group_msg_reacts r
    join public.group_msgs gm on gm.id = r.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = r.user_id
   where r.active
   group by r.msg_id, r.emoji;
end;
$$;

revoke all on function public.react_msg(bigint, text) from public, anon;
revoke all on function public.msg_reacts(uuid) from public, anon;
grant execute on function public.react_msg(bigint, text) to authenticated;
grant execute on function public.msg_reacts(uuid) to authenticated;

-- ===== 0021_chat_no_wait.sql =====
-- 0021 Chat without waiting: the 20 s wait between messages is gone. Flood guard only: max 10 messages per 20 s.
create or replace function public.post_group_msg(p_group_id uuid, p_body text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x08\x0B-\x1F\x7F]', '', 'g'));
  v_id bigint; v_at timestamptz;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 140 then raise exception 'invalid_msg'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_msg:' || v_uid::text, 0));
  -- Chat like other apps: no wait between messages. Only a flood guard (max 10 messages per 20 s).
  if (select count(*) from public.group_msgs m where m.user_id = v_uid and m.created_at > now() - interval '20 seconds') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, public.olnu_next_expiry())
  returning group_msgs.id, group_msgs.created_at into v_id, v_at;
  return json_build_object('id', v_id, 'created_at', v_at);
end; $function$;

-- ===== 0022_more_drinks.sql =====
-- 0022 Grogg and bubbel. post_other_v2 accepts the old kinds plus 'grogg' and 'bubbel'.
-- New kinds go through post_other('annat') (same cooldown and rules) and then set other_kind.
create or replace function public.post_other_v2(p_kind text, p_lat double precision, p_lng double precision, p_precise boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_r    jsonb;
begin
  if v_kind not in ('rom', 'vin', 'cider', 'drink', 'shot', 'whisky', 'annat', 'grogg', 'bubbel') then
    raise exception 'invalid_kind';
  end if;
  if v_kind in ('grogg', 'bubbel') then
    v_r := public.post_other('annat', p_lat, p_lng, p_precise)::jsonb;
    if (v_r->>'accepted')::boolean then
      update public.beers set other_kind = v_kind where id = (v_r->>'id')::bigint and user_id = v_uid;
      v_r := jsonb_set(v_r, '{other_kind}', to_jsonb(v_kind));
    end if;
    return v_r::json;
  end if;
  return public.post_other(v_kind, p_lat, p_lng, p_precise);
end;
$$;
revoke all on function public.post_other_v2(text, double precision, double precision, boolean) from public, anon;
grant execute on function public.post_other_v2(text, double precision, double precision, boolean) to authenticated;

-- ===== supabase/migrations/0023_world_alldrinks_boards.sql =====
-- 0023 v17: WORLDWIDE posts, ALL DRINKS count, LOCAL TOPPLISTA (opt-in) and WALL OF FAME (additive).
-- Needs 0001–0022. Safe to re-run. No function changes its return type; new fields go at the end of json.
--
-- 1. Worldwide: every position check accepts |lat| <= 85, lng -180..180 (finite). The error code stays
--    'outside_sweden' (now = invalid coordinates). post_beer / post_other keep their old Sweden-only bodies
--    (old apps); post_beer_v2 / post_other_v2 accept the world: a point outside Sweden is posted through the
--    old body at a placeholder point and a BEFORE trigger (olnu_a_world_pos, runs first) puts the real,
--    rounded position on the row before any other trigger sees it.
-- 2. All drinks: week_beers (lifetime, titles, leagues, my_stats, friend totals) counts beers + other drinks;
--    medals use beers + others per night; owner stats get drink totals; notify-group levels use drinks.
--    Backfill: lifetime >= tonight's drinks for every live row; quiet (titles pre-claimed, notified_level set).
-- 3. Topplista + Wall of Fame: board_optin, board_nights, board_bars, board_rl; RPCs set_board_optin,
--    my_board_optin, local_board, wall_of_fame. Names only for users who opted in. Never positions.

-- ---------------------------------------------------------------------------
-- A. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.olnu_world_ok(p_lat float8, p_lng float8)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between -85.0 and 85.0 and p_lng between -180.0 and 180.0;
$$;

create or replace function public.olnu_in_se_box(p_lat float8, p_lng float8)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_lat between 55.0 and 69.1 and p_lng between 10.9 and 24.2;
$$;

-- Level of a drink count (same rule as notify-group milestoneLevel).
create or replace function public.olnu_drink_level(p_n int)
returns int
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_n, 0) >= 10 then 10 when coalesce(p_n, 0) >= 5 then 5
              when coalesce(p_n, 0) >= 1 then 1 else 0 end;
$$;

-- ---------------------------------------------------------------------------
-- B. Worldwide posting through the v2 RPCs
-- ---------------------------------------------------------------------------
-- olnu.world_pos = 'lat,lng' (transaction-local, set only by post_beer_v2 / post_other_v2).
-- The old bodies are called with the placeholder 62.0, 15.0 (exact after both roundings).
create or replace function public.olnu_world_pos_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s   text := coalesce(current_setting('olnu.world_pos', true), '');
  v_lat float8;
  v_lng float8;
begin
  if v_s = '' or new.lat is distinct from 62.0::float8 or new.lng is distinct from 15.0::float8 then
    return new;
  end if;
  v_lat := split_part(v_s, ',', 1)::float8;
  v_lng := split_part(v_s, ',', 2)::float8;
  if not public.olnu_world_ok(v_lat, v_lng) then
    return new;
  end if;
  if new.precise then
    new.lat := round(v_lat::numeric, 5)::float8;
    new.lng := round(v_lng::numeric, 5)::float8;
  else
    new.lat := (round(v_lat::numeric / 0.005) * 0.005)::float8;
    new.lng := (round(v_lng::numeric / 0.01) * 0.01)::float8;
  end if;
  return new;
end; $$;

-- BEFORE triggers fire in name order: olnu_a_world_pos runs before olnu_beer_prev / olnu_beer_snap.
create or replace trigger olnu_a_world_pos
  before insert or update on public.beers
  for each row execute function public.olnu_world_pos_tg();

create or replace function public.post_beer_v2(p_lat double precision, p_lng double precision, p_precise boolean, p_hidden boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_hidden boolean := coalesce(p_hidden, false);
  v_lat    float8 := p_lat;
  v_lng    float8 := p_lng;
  v_r      jsonb;
  v_row    public.beers%rowtype;
  v_drinks int;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if not public.olnu_in_se_box(p_lat, p_lng) then
    perform set_config('olnu.world_pos', p_lat::text || ',' || p_lng::text, true);
    v_lat := 62.0;
    v_lng := 15.0;
  end if;
  if v_hidden then
    perform set_config('olnu.ghost', '1', true);
    v_r := public.post_beer(v_lat, v_lng, false)::jsonb;
    perform set_config('olnu.ghost', '', true);
    perform set_config('olnu.world_pos', '', true);
    if (v_r->>'accepted')::boolean then
      update public.beers set stopped = true, ghost = true
       where id = (v_r->>'id')::bigint and user_id = v_uid;
      -- No beer_events row, so count the beer for the owner page here.
      begin
        insert into public.owner_hours as h (hour, beers) values (date_trunc('hour', now()), 1)
        on conflict (hour) do update set beers = h.beers + 1;
      exception when others then
        null;
      end;
    end if;
  else
    v_r := public.post_beer(v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
  end if;

  select * into v_row from public.beers b where b.id = (v_r->>'id')::bigint;
  v_drinks := coalesce(v_row.beer_count, 0) + coalesce(v_row.other_count, 0);
  return v_r || jsonb_build_object(
    'hidden', coalesce(v_row.stopped, false),
    'undo_until', case when (v_r->>'accepted')::boolean then v_row.beer_at + interval '2 minutes' end,
    'undos_left', greatest(0, 3 - coalesce(v_row.undo_count, 0)),
    'lat', v_row.lat,
    'lng', v_row.lng,
    'drinks', v_drinks,
    'milestone', case when (v_r->>'accepted')::boolean and v_drinks in (1, 5, 10) then v_drinks end);
end;
$$;

create or replace function public.post_other_v2(p_kind text, p_lat double precision, p_lng double precision, p_precise boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_lat    float8 := p_lat;
  v_lng    float8 := p_lng;
  v_r      jsonb;
  v_row    public.beers%rowtype;
  v_drinks int;
begin
  if v_kind not in ('rom', 'vin', 'cider', 'drink', 'shot', 'whisky', 'annat', 'grogg', 'bubbel') then
    raise exception 'invalid_kind';
  end if;
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if not public.olnu_in_se_box(p_lat, p_lng) then
    perform set_config('olnu.world_pos', p_lat::text || ',' || p_lng::text, true);
    v_lat := 62.0;
    v_lng := 15.0;
  end if;
  if v_kind in ('grogg', 'bubbel') then
    v_r := public.post_other('annat', v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
    if (v_r->>'accepted')::boolean then
      update public.beers set other_kind = v_kind where id = (v_r->>'id')::bigint and user_id = v_uid;
      v_r := jsonb_set(v_r, '{other_kind}', to_jsonb(v_kind));
    end if;
  else
    v_r := public.post_other(v_kind, v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
  end if;
  select * into v_row from public.beers b where b.id = (v_r->>'id')::bigint;
  v_drinks := coalesce(v_row.beer_count, 0) + coalesce(v_row.other_count, 0);
  return (v_r || jsonb_build_object(
    'lat', v_row.lat,
    'lng', v_row.lng,
    'drinks', v_drinks,
    'milestone', case when (v_r->>'accepted')::boolean and v_drinks in (1, 5, 10) then v_drinks end))::json;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Same bodies as before with world bounds (check_in, record_bar, set_push_location, create_rally,
--    olnu_bp_in_sweden (queue/offer/beer_type_stats), olnu_g_crawl, olnu_g_guess, poll_v2) and
--    all-drinks counting (olnu_week_beers_tg, olnu_medal_beers_tg, olnu_medal_eval, award_medals,
--    claim_medevac). Generated from the live definitions; only the bounds / counts changed.
-- ---------------------------------------------------------------------------
-- The week trigger now also fires on other drinks (it fired on beer_count only).
create or replace trigger olnu_week_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_week_beers_tg();

-- set_push_location
create or replace function public.set_push_location(p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < -85.0 or p_lat > 85.0 or p_lng < -180.0 or p_lng > 180.0 then
    return;
  end if;
  update public.push_subscriptions
     set lat = round(p_lat::numeric, 2)::float8,
         lng = round(p_lng::numeric, 2)::float8,
         loc_at = now()
   where user_id = v_uid;
end;
$function$;

-- check_in
create or replace function public.check_in(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     or p_lat < -85.0 or p_lat > 85.0 or p_lng < -180.0 or p_lng > 180.0 then
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
$function$;

-- record_bar
create or replace function public.record_bar(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     or p_lat < -85.0 or p_lat > 85.0 or p_lng < -180.0 or p_lng > 180.0 then
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
$function$;

-- create_rally
create or replace function public.create_rally(p_group_id uuid, p_body text, p_place text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     and p_lat between -85.0 and 85.0 and p_lng between -180.0 and 180.0 then
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
$function$;

-- olnu_bp_in_sweden
create or replace function public.olnu_bp_in_sweden(p_lat double precision, p_lng double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between -85.0 and 85.0 and p_lng between -180.0 and 180.0;
$function$;

-- olnu_g_crawl
create or replace function public.olnu_g_crawl(p_uid uuid, p_group uuid, p_stops jsonb, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_stops jsonb;
  v_n int; v_ids int; v_bad int;
  v_id bigint;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) not between 2 and 6 then
    raise exception 'invalid_crawl';
  end if;
  begin
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'lat', round(x.lat::numeric, 5)::float8,
             'lng', round(x.lng::numeric, 5)::float8) order by x.ord),
           count(*), count(distinct x.id),
           count(*) filter (where x.id is null or char_length(x.id) not between 1 and 80
                              or x.name is null or char_length(x.name) not between 1 and 60
                              or x.lat is null or x.lng is null
                              or x.lat not between -85.0 and 85.0 or x.lng not between -180.0 and 180.0)
      into v_stops, v_n, v_ids, v_bad
      from (select e.ord,
                   btrim(e.v->>'id') as id,
                   btrim(regexp_replace(regexp_replace(coalesce(e.v->>'name', ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')) as name,
                   (e.v->>'lat')::float8 as lat, (e.v->>'lng')::float8 as lng
              from jsonb_array_elements(p_stops) with ordinality e(v, ord)) x;
  exception when others then
    raise exception 'invalid_crawl';
  end;
  if v_bad > 0 or v_ids <> v_n then
    raise exception 'invalid_crawl';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  if exists (select 1 from public.game_crawls c where c.user_id = p_uid and c.created_at > p_now - interval '2 minutes'
                                                  and c.created_at <= p_now) then
    raise exception 'slow_down';
  end if;
  update public.game_crawls c set closed = true where c.group_id = p_group and c.night = v_night and not c.closed;
  insert into public.game_crawls (group_id, user_id, night, stops, n, created_at)
  values (p_group, p_uid, v_night, v_stops, v_n, p_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'n', v_n);
end;
$function$;

-- olnu_g_guess
create or replace function public.olnu_g_guess(p_uid uuid, p_guess integer, p_town text, p_lat double precision, p_lng double precision, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_close timestamptz := (public.olnu_evening(public.olnu_night_of(p_now))::timestamp + interval '21 hours') at time zone 'Europe/Stockholm';
  v_town  text := left(btrim(regexp_replace(regexp_replace(coalesce(p_town, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), 40);
  v_ch    int;
begin
  if p_now >= v_close then
    raise exception 'too_late';
  end if;
  if p_guess is null or p_guess not between 0 and 20000 then
    raise exception 'invalid_guess';
  end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng
     or p_lat not between -85.0 and 85.0 or p_lng not between -180.0 and 180.0 then
    raise exception 'outside_sweden';
  end if;
  if v_town = '' then v_town := 'Närområdet'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select g.changes into v_ch from public.game_guesses g where g.user_id = p_uid and g.night = v_night;
  if coalesce(v_ch, 0) >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.game_guesses as g (user_id, night, guess, town, lat, lng, created_at, updated_at)
  values (p_uid, v_night, p_guess, v_town, round(p_lat::numeric, 2)::float8, round(p_lng::numeric, 2)::float8, p_now, p_now)
  on conflict (user_id, night) do update
     set guess = excluded.guess, town = excluded.town, lat = excluded.lat, lng = excluded.lng,
         updated_at = excluded.updated_at, changes = g.changes + 1;
  return jsonb_build_object('ok', true, 'guess', p_guess, 'town', v_town, 'closes_at', v_close);
end;
$function$;

-- poll_v2
create or replace function public.poll_v2(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_heat boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := public.olnu_uid();
  v_cap     constant int := 1500;
  v_a       float8; v_b float8; v_c float8; v_d float8;   -- min lat, min lng, max lat, max lng (+ margin)
  v_clat    float8; v_clng float8; v_cos float8;
  v_mlat    float8; v_mlng float8;
  v_pins    json;
  v_n_str   int;
  v_me      jsonb;
  v_row     public.beers%rowtype;
  v_out     json;
  v_bucket  bigint := floor(extract(epoch from now()) / 600)::bigint;
begin
  if p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
     or 'NaN'::float8 in (p_min_lat, p_min_lng, p_max_lat, p_max_lng)
     or abs(p_min_lat) = 'Infinity'::float8 or abs(p_max_lat) = 'Infinity'::float8
     or abs(p_min_lng) = 'Infinity'::float8 or abs(p_max_lng) = 'Infinity'::float8 then
    raise exception 'invalid_bbox';
  end if;
  v_a := least(p_min_lat, p_max_lat);  v_c := greatest(p_min_lat, p_max_lat);
  v_b := least(p_min_lng, p_max_lng);  v_d := greatest(p_min_lng, p_max_lng);
  -- v17: worldwide. A box across the date line (min lng > max lng) = the whole lng range.
  if p_min_lng > p_max_lng and p_min_lng <= 180 and p_max_lng >= -180 then
    v_b := -180;  v_d := 180;
  end if;
  -- 15 % margin on each side (at least ~550 m), then clamp to the world (|lat| <= 85).
  v_mlat := greatest((v_c - v_a) * 0.15, 0.005);
  v_mlng := greatest((v_d - v_b) * 0.15, 0.01);
  v_a := greatest(-85.0, v_a - v_mlat);  v_c := least(85.0, v_c + v_mlat);
  v_b := v_b - v_mlng;  v_d := v_d + v_mlng;
  if v_b < -180 or v_d > 180 then v_b := -180;  v_d := 180; end if;
  if v_a > v_c or v_b > v_d then
    -- Empty box: only the caller and group-mates.
    v_a := 0; v_c := 0; v_b := 0; v_d := 0;
  end if;
  v_clat := (v_a + v_c) / 2;  v_clng := (v_b + v_d) / 2;  v_cos := cos(radians(v_clat));

  with p as (
    select * from public.olnu_pins(v_uid, v_a, v_b, v_c, v_d)
  ),
  ranked as (
    select p.*,
           row_number() over (partition by (p.is_mine or p.is_friend)
                              order by power(p.lat - v_clat, 2) + power((p.lng - v_clng) * v_cos, 2), p.pin_id) as rn,
           count(*) filter (where not (p.is_mine or p.is_friend)) over () as nstr
      from p
  ),
  sel as (
    select * from ranked r where r.is_mine or r.is_friend or r.rn <= v_cap
  ),
  sk as (
    select s.beer_id as sid, count(*)::int as n, bool_or(s.user_id = v_uid) as mine
      from public.skals s join sel on sel.beer_id = s.beer_id
     group by s.beer_id
  ),
  rx1 as (
    select r.beer_id as rid, r.emoji, count(*)::int as n, bool_or(r.user_id = v_uid) as mine
      from public.reactions r join sel on sel.beer_id = r.beer_id
     where r.active
     group by r.beer_id, r.emoji
  ),
  rx as (
    select rx1.rid, jsonb_object_agg(rx1.emoji, rx1.n) as counts,
           coalesce(jsonb_agg(rx1.emoji order by rx1.emoji) filter (where rx1.mine), '[]'::jsonb) as mine
      from rx1 group by rx1.rid
  )
  -- Compact rows: null, false, 0 and empty values are left out (clients treat a missing field as empty).
  select coalesce(json_agg(json_strip_nulls(json_build_object(
           'id',          case when sel.is_mine or sel.is_friend then to_json(sel.beer_id) else to_json(sel.pin_id) end,
           'lat',         sel.lat,
           'lng',         sel.lng,
           'snap',        sel.snap,
           'bar_id',      sel.bar_id,
           'precise',     sel.precise,
           'beer_count',  sel.beer_count,
           'other_count', nullif(sel.other_count, 0),
           'other_kind',  case when sel.other_count > 0 then sel.other_kind end,
           'created_at',  sel.created_at,
           'is_mine',     case when sel.is_mine then true end,
           'is_friend',   case when sel.is_friend then true end,
           'friend_name', case when sel.is_mine then null else sel.friend_name end,
           'skal_count',  sk.n,
           'i_skaled',    case when sk.mine then true end,
           'rx',          rx.counts,
           'my_rx',       case when rx.mine <> '[]'::jsonb then rx.mine end,
           'total',       case when sel.is_mine or sel.is_friend then public.olnu_lifetime(
                            (select b.user_id from public.beers b where b.id = sel.beer_id)) end
         )) order by sel.created_at, sel.pin_id), '[]'::json),
         coalesce(max(sel.nstr), 0)
    into v_pins, v_n_str
    from sel
    left join sk on sk.sid = sel.beer_id
    left join rx on rx.rid = sel.beer_id;

  select * into v_row from public.beers b where b.user_id = v_uid and b.expires_at > now();
  v_me := public.my_stats()::jsonb || jsonb_build_object(
    'id',           v_row.id,
    'beer_count',   coalesce(v_row.beer_count, 0),
    'other_count',  coalesce(v_row.other_count, 0),
    'other_kind',   v_row.other_kind,
    'lat',          v_row.lat,
    'lng',          v_row.lng,
    'precise',      v_row.precise,
    'hidden',       coalesce(v_row.stopped, false),
    'ghost',        coalesce(v_row.ghost, false),
    'expires_at',   v_row.expires_at,
    'beer_at',      v_row.beer_at,
    'wait_seconds', case when v_row.beer_count > 0 and v_row.beer_at > now() - interval '10 minutes'
                         then greatest(1, ceil(extract(epoch from (v_row.beer_at + interval '10 minutes' - now())))::int)
                         else 0 end,
    'undo_until',   case when v_row.beer_count > 0 and coalesce(v_row.undo_count, 0) < 3
                          and v_row.beer_at > now() - interval '2 minutes'
                          and (v_row.prev_for = v_row.beer_count or v_row.beer_count = 1)
                         then v_row.beer_at + interval '2 minutes' end,
    'undos_left',   greatest(0, 3 - coalesce(v_row.undo_count, 0)));

  v_out := json_build_object(
    'v',            1,
    'server_time',  now(),
    'full',         true,
    'ids_until',    to_timestamp((v_bucket + 1) * 600),
    'bbox',         json_build_array(v_a, v_b, v_c, v_d),
    'pins',         v_pins,
    'capped',       v_n_str > v_cap,
    'pins_in_view', v_n_str,
    'live_total',   (select count(*)::int from public.beers b
                      where b.expires_at > now() and not b.stopped
                        and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)),
    'me',           v_me::json,
    'checkins',     (select coalesce(json_agg(json_build_object(
                        'bar_id', c.bar_id, 'bar_name', c.bar_name, 'lat', c.lat, 'lng', c.lng,
                        'name', case when c.user_id = v_uid
                                     then (select min(mm.display_name) from public.group_members mm where mm.user_id = v_uid)
                                     else f.fname end,
                        'is_mine', c.user_id = v_uid,
                        'is_friend', c.user_id <> v_uid and f.fname is not null,
                        'created_at', case when c.user_id = v_uid or f.fname is not null then c.created_at
                                           else to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900) end
                      ) order by c.created_at), '[]'::json)
                       from (select * from public.checkins c0
                              where c0.expires_at > now()
                              order by c0.created_at limit 2000) c
                       left join lateral (
                         select min(am.display_name) as fname
                           from public.group_members am
                           join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
                          where am.user_id = c.user_id and c.user_id <> v_uid
                       ) f on true
                      where c.user_id = v_uid or f.fname is not null
                         or (c.lat between v_a and v_c and c.lng between v_b and v_d)),
    'rallies',      (select coalesce(json_agg(to_json(r) order by r.created_at desc, r.id desc), '[]'::json)
                       from public.olnu_rally_rows(v_uid, null) r),
    'heat',         case when coalesce(p_heat, false) then
                      (select coalesce(json_agg(json_build_array(h.lat, h.lng, h.w)), '[]'::json)
                         from public.olnu_heat(v_a - (v_c - v_a) * 0.5, v_b - (v_d - v_b) * 0.5,
                                               v_c + (v_c - v_a) * 0.5, v_d + (v_d - v_b) * 0.5, 3000) h)
                    end
  );
  return v_out;
end;
$function$;

-- olnu_medal_eval
create or replace function public.olnu_medal_eval(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total int := public.olnu_lifetime(p_uid);
  v_nights int; v_bars int; v_rounds int; v_regular int;
  v_sg int := 0; v_sr int := 0; v_msgs int := 0;
  v_yes int; v_rallies int; v_home int; v_day int; v_owl int; v_tue int;
  v_first int; v_king int; v_league int; v_cells int; v_side int; v_hot int; v_med int;
  v_valb int; v_mids int; v_luc int; v_nyar int; v_group int; v_comp int;
  v_week date := public.olnu_week_start(now());
begin
  select count(*) filter (where (mn.beers + mn.others) >= 1),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.home),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.early),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.owl),
         count(*) filter (where (mn.beers + mn.others) >= 1 and extract(isodow from public.olnu_evening(mn.night)) = 2),
         count(*) filter (where mn.others >= 1),
         count(*) filter (where (mn.beers + mn.others) >= 5),
         count(*) filter (where (mn.beers + mn.others) >= 10),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '04-30'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') between '06-19' and '06-25'
                   and extract(isodow from public.olnu_evening(mn.night)) = 5),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-13'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-31'),
         count(distinct mn.cell) filter (where (mn.beers + mn.others) >= 1)
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
   where mn.user_id = p_uid and (mn.beers + mn.others) >= 1 and mn.first_at is not null
     and exists (select 1 from public.medal_nights o
                  where o.night = mn.night and (o.beers + o.others) >= 1 and o.user_id <> p_uid
                    and o.user_id in (select am.user_id from public.group_members am
                                        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid))
     and not exists (select 1 from public.medal_nights o
                      where o.night = mn.night and (o.beers + o.others) >= 1 and o.user_id <> p_uid and o.first_at < mn.first_at
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
$function$;

-- award_medals
create or replace function public.award_medals(p_event text DEFAULT NULL::text)
 RETURNS TABLE(medal text, count integer, is_new boolean, earned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  if lower(btrim(coalesce(p_event, ''))) = 'home' then
    update public.medal_nights mn set home = true
      from public.beers b
     where b.user_id = v_uid and b.expires_at > now() and (b.beer_count + coalesce(b.other_count, 0)) >= 1
       and mn.user_id = v_uid and mn.night = b.expires_at;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$function$;

-- claim_medevac
create or replace function public.claim_medevac(p_beer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_b   record;
  v_row public.medevac_checks;
begin
  select b.user_id, b.expires_at, b.beer_count + coalesce(b.other_count, 0) as beer_count into v_b from public.beers b
   where b.id = p_beer_id and b.expires_at > now();
  if not found or coalesce(v_b.beer_count, 0) < 10 then
    raise exception 'beer_not_found';
  end if;
  if v_b.user_id = v_uid then
    raise exception 'own_beer';
  end if;
  if not public.olnu_shares_group(v_uid, v_b.user_id) then
    raise exception 'not_friend';
  end if;
  insert into public.medevac_checks (target, night, checker)
  values (v_b.user_id, v_b.expires_at, v_uid)
  on conflict (target, night) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('ok', true, 'mine', true, 'id', v_row.id, 'checker', public.olnu_name_for(v_uid, v_uid));
  end if;
  select * into v_row from public.medevac_checks c where c.target = v_b.user_id and c.night = v_b.expires_at;
  return jsonb_build_object('ok', false, 'mine', v_row.checker = v_uid, 'id', v_row.id,
    'checker', public.olnu_name_for(v_uid, v_row.checker));
end;
$function$;

-- olnu_medal_beers_tg
create or replace function public.olnu_medal_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- v17: other drinks start a night too (first_at, early, owl, cell).
      insert into public.medal_nights as m (user_id, night, others, first_at, early, owl, cell)
      values (new.user_id, new.expires_at, new.other_count, now(),
              v_h >= 5 and v_h < 16, v_h >= 1 and v_h < 5, public.olnu_cell(new.lat, new.lng))
      on conflict (user_id, night) do update
         set others = greatest(m.others, excluded.others),
             first_at = coalesce(m.first_at, excluded.first_at),
             early = m.early or excluded.early,
             owl = m.owl or excluded.owl,
             cell = coalesce(m.cell, excluded.cell);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;

-- olnu_week_beers_tg
create or replace function public.olnu_week_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inc int;
begin
  if tg_op = 'INSERT' then
    v_inc := coalesce(new.beer_count, 0) + coalesce(new.other_count, 0);
  else
    v_inc := (coalesce(new.beer_count, 0) + coalesce(new.other_count, 0))
           - (coalesce(old.beer_count, 0) + coalesce(old.other_count, 0));
  end if;
  if v_inc > 0 then
    insert into public.week_beers (user_id, week, n)
    values (new.user_id, public.olnu_week_start(now()), v_inc)
    on conflict (user_id, week) do update set n = public.week_beers.n + excluded.n;
  end if;
  return new;
end; $function$;

-- ---------------------------------------------------------------------------
-- D. Owner stats: drink totals (beers + other drinks). Same keys as before plus new keys at the end of
--    each object: per night 'drinks'; beers 'drinks_tonight', 'drinks_last_night'. hot/medevac use drinks.
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
  v_next      timestamptz := public.olnu_next_expiry();
  v_next_loc  timestamp := public.olnu_next_expiry() at time zone 'Europe/Stockholm';
  v_first     timestamptz;
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'night', to_char(((g.night at time zone v_tz) - interval '6 hours')::date, 'YYYY-MM-DD'),
           'beers', greatest(coalesce(u.b, 0), coalesce(e.b, 0)),
           'others', coalesce(u.o, 0),
           'people', coalesce(u.p, 0),
           'hot', greatest(coalesce(u.hot, 0), coalesce(e.hot, 0)),
           'medevac', greatest(coalesce(u.med, 0), coalesce(e.med, 0)),
           'home', coalesce(u.home, 0),
           'drinks', greatest(coalesce(u.b, 0), coalesce(e.b, 0)) + coalesce(u.o, 0)
         ) order by g.night), '[]'::jsonb)
    into v_nights
    from (select (v_next_loc - make_interval(days => k)) at time zone v_tz as night
            from generate_series(0, 29) k) g
    left join (select night, sum(b)::int b, sum(o)::int o,
                      count(*) filter (where b > 0 or o > 0)::int p,
                      count(*) filter (where b + o >= 5 and b + o < 10)::int hot,
                      count(*) filter (where b + o >= 10)::int med,
                      count(*) filter (where home)::int home
                 from public.olnu_owner_un(v_first) group by night) u on u.night = g.night
    left join (select expires_at night, count(*)::int b,
                      count(*) filter (where n = 5)::int hot,
                      count(*) filter (where n = 10)::int med
                 from public.beer_events where kind = 'beer' and expires_at >= v_first
                group by 1) e on e.night = g.night;

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

  -- owner_hours counts every drink from v17 (beers via beer_events, other drinks via olnu_board_beers_tg).
  select coalesce(jsonb_agg(coalesce(h.n, 0) order by g.hr), '[]'::jsonb) into v_hours
    from generate_series(0, 23) g(hr)
    left join (select extract(hour from (hour at time zone v_tz))::int hr, sum(beers)::int n
                 from public.owner_hours where hour > v_now - interval '30 days' group by 1) h on h.hr = g.hr;

  select jsonb_build_object(
    'tonight', (v_nights -> 29 ->> 'beers')::int,
    'others_tonight', (v_nights -> 29 ->> 'others')::int,
    'last_night', (v_nights -> 28 ->> 'beers')::int,
    'per_night', v_nights,
    'all_time', greatest(
        (select coalesce(sum(n), 0) from public.week_beers),
        (select count(*) from public.beer_events where kind = 'beer'),
        case when v_medals then (select coalesce(sum(beers + others), 0) from public.medal_nights) else 0 end),
    'avg_per_person', (select round(avg(b + o)::numeric, 2) from public.olnu_owner_un(v_first) where b + o > 0),
    'peak_hours', v_hours,
    'drinks_tonight', (v_nights -> 29 ->> 'drinks')::int,
    'drinks_last_night', (v_nights -> 28 ->> 'drinks')::int
  ) into v_beers;

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

  select jsonb_build_object(
    'groups', (select count(*) from public.groups),
    'groups_2plus', (select count(*) from (select group_id from public.group_members group by 1 having count(*) >= 2) g),
    'avg_group_size', (select round(avg(c)::numeric, 1) from (select count(*) c from public.group_members group by group_id) g),
    'msgs_7d', (select count(*) from public.group_msgs where created_at > v_now - interval '7 days'),
    'skal_7d', (select count(*) from public.skals where created_at > v_now - interval '7 days'),
    'rallies_7d', (select count(*) from public.rallies where created_at > v_now - interval '7 days'),
    'reactions_7d', (select count(*) from public.reactions where created_at > v_now - interval '7 days')
  ) into v_social;

  select jsonb_build_object(
    'hot_tonight', (select count(*) from public.beers where expires_at = v_next
                       and beer_count + coalesce(other_count, 0) >= 5 and beer_count + coalesce(other_count, 0) < 10),
    'medevac_tonight', (select count(*) from public.beers where expires_at = v_next
                           and beer_count + coalesce(other_count, 0) >= 10),
    'home_7d', (select coalesce(sum((x ->> 'home')::int), 0)
                  from jsonb_array_elements(v_nights) with ordinality as a(x, i) where a.i > 23),
    'home_tracked', v_medals
  ) into v_care;

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

-- ---------------------------------------------------------------------------
-- E. Board tables (RLS on, no policies, no client access). Rows are never removed.
-- ---------------------------------------------------------------------------
create table if not exists public.board_optin (
  user_id    uuid primary key,
  show       boolean not null default false,
  name       text check (name is null or char_length(name) between 1 and 30),
  updated_at timestamptz not null default now()
);
-- Per user and night: drinks (beers + other drinks) and the rough place (lat 0.05°, lng 0.1° ≈ 5 km).
create table if not exists public.board_nights (
  user_id    uuid not null,
  night      timestamptz not null,
  drinks     int not null default 0,
  lat        float8,
  lng        float8,
  updated_at timestamptz not null default now(),
  primary key (user_id, night)
);
create index if not exists board_nights_night_idx on public.board_nights (night);
create index if not exists board_nights_pos_idx on public.board_nights (lat, lng);
-- Bar positions seen in check-ins / king taps (bars abroad are not in bars_lite).
create table if not exists public.board_bars (
  bar_id     text primary key,
  lat        float8 not null,
  lng        float8 not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.board_rl (
  user_id uuid primary key,
  win     timestamptz not null,
  n       int not null default 0
);
alter table public.board_optin  enable row level security;
alter table public.board_nights enable row level security;
alter table public.board_bars   enable row level security;
alter table public.board_rl     enable row level security;
revoke all on public.board_optin, public.board_nights, public.board_bars, public.board_rl from anon, authenticated;

-- "Radera allt om mig" moves rows to a new random id: an opt-in never follows the row.
create or replace function public.olnu_board_optin_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    new.show := false;
    new.name := null;
  end if;
  return new;
end; $$;
create or replace trigger olnu_board_optin_move
  before update on public.board_optin
  for each row execute function public.olnu_board_optin_tg();

-- Drink count changed → board_nights; an other drink → owner_hours (beers come via beer_events).
create or replace function public.olnu_board_beers_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int := coalesce(new.beer_count, 0) + coalesce(new.other_count, 0);
  v_old int := 0;
  v_oo  int := 0;
begin
  begin
    if tg_op = 'UPDATE' then
      v_old := coalesce(old.beer_count, 0) + coalesce(old.other_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if v_new <> v_old and (v_new > 0 or tg_op = 'UPDATE') then
      insert into public.board_nights as n (user_id, night, drinks, lat, lng, updated_at)
      values (new.user_id, new.expires_at, v_new,
              (round(new.lat::numeric / 0.05) * 0.05)::float8, (round(new.lng::numeric / 0.1) * 0.1)::float8, now())
      on conflict (user_id, night) do update
         set drinks = excluded.drinks,
             lat = case when excluded.drinks > n.drinks or n.lat is null then excluded.lat else n.lat end,
             lng = case when excluded.drinks > n.drinks or n.lng is null then excluded.lng else n.lng end,
             updated_at = now();
    end if;
    if coalesce(new.other_count, 0) > v_oo then
      insert into public.owner_hours as h (hour, beers) values (date_trunc('hour', now()), coalesce(new.other_count, 0) - v_oo)
      on conflict (hour) do update set beers = h.beers + excluded.beers;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;
create or replace trigger olnu_board_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_board_beers_tg();

create or replace function public.olnu_board_bar_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.bar_id is not null and public.olnu_world_ok(new.lat, new.lng) then
      insert into public.board_bars as b (bar_id, lat, lng, updated_at)
      values (new.bar_id, new.lat, new.lng, now())
      on conflict (bar_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;
create or replace trigger olnu_board_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_board_bar_tg();
create or replace trigger olnu_board_bar_taps
  after insert or update on public.bar_taps
  for each row execute function public.olnu_board_bar_tg();

-- Backfill board_bars (check-ins, king taps) and board_nights (medal_nights history; place from the
-- night's check-ins, else the town, else the ~50 km cell centre; then real pin rows override).
insert into public.board_bars (bar_id, lat, lng)
select distinct on (x.bar_id) x.bar_id, x.lat, x.lng
  from (select c.bar_id, c.lat, c.lng, c.created_at at from public.checkins c
        union all
        select t.bar_id, t.lat, t.lng, t.last_at from public.bar_taps t) x
 where x.bar_id is not null and public.olnu_world_ok(x.lat, x.lng)
 order by x.bar_id, x.at desc
on conflict (bar_id) do nothing;

insert into public.board_nights (user_id, night, drinks, lat, lng)
select mn.user_id, mn.night, mn.beers + mn.others,
       (round(coalesce(ck.lat, tw.lat, nullif(split_part(mn.cell, ':', 1), '')::float8)::numeric / 0.05) * 0.05)::float8,
       (round(coalesce(ck.lng, tw.lng, nullif(split_part(mn.cell, ':', 2), '')::float8)::numeric / 0.1) * 0.1)::float8
  from public.medal_nights mn
  left join public.after_nights an on an.user_id = mn.user_id and an.night = mn.night
  left join public.olnu_towns tw on tw.name = an.town
  left join lateral (
    select avg(p.lat) lat, avg(p.lng) lng
      from public.medal_checkins c
      join lateral (select bl.lat, bl.lng from public.bars_lite bl where bl.id = c.bar_id
                    union all
                    select bb.lat, bb.lng from public.board_bars bb where bb.bar_id = c.bar_id
                    limit 1) p on true
     where c.user_id = mn.user_id and c.night = mn.night) ck on true
 where mn.beers + mn.others > 0
on conflict (user_id, night) do nothing;

insert into public.board_nights as n (user_id, night, drinks, lat, lng)
select b.user_id, b.expires_at, b.beer_count + coalesce(b.other_count, 0),
       (round(b.lat::numeric / 0.05) * 0.05)::float8, (round(b.lng::numeric / 0.1) * 0.1)::float8
  from public.beers b
 where b.beer_count + coalesce(b.other_count, 0) > 0
on conflict (user_id, night) do update
   set drinks = greatest(n.drinks, excluded.drinks), lat = excluded.lat, lng = excluded.lng, updated_at = now();

-- ---------------------------------------------------------------------------
-- F. Board RPCs
-- ---------------------------------------------------------------------------
-- Max 30 board reads per user per minute → slow_down.
create or replace function public.olnu_board_rl(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  insert into public.board_rl as r (user_id, win, n) values (p_uid, date_trunc('minute', now()), 1)
  on conflict (user_id) do update
     set n = case when r.win = excluded.win then r.n + 1 else 1 end, win = excluded.win
  returning r.n into v_n;
  if v_n > 30 then
    raise exception 'slow_down';
  end if;
end; $$;

-- Name on the boards: only for users who opted in (own board name, else a group display name).
create or replace function public.olnu_board_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when o.show then coalesce(o.name, (select min(m.display_name) from public.group_members m where m.user_id = p_uid)) end
    from public.board_optin o where o.user_id = p_uid;
$$;

create or replace function public.my_board_optin()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.board_optin%rowtype;
begin
  select * into v_row from public.board_optin o where o.user_id = v_uid;
  return jsonb_build_object('on', coalesce(v_row.show, false), 'name', v_row.name);
end; $$;

-- p_name (optional): the name to show (1–30 chars after cleaning, else invalid_name). Null keeps the old one.
create or replace function public.set_board_optin(p_on boolean, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
  v_row  public.board_optin%rowtype;
begin
  if p_name is not null and char_length(v_name) not between 1 and 30 then
    raise exception 'invalid_name';
  end if;
  insert into public.board_optin as o (user_id, show, name, updated_at)
  values (v_uid, coalesce(p_on, false), nullif(v_name, ''), now())
  on conflict (user_id) do update
     set show = excluded.show, name = coalesce(excluded.name, o.name), updated_at = now()
  returning * into v_row;
  return jsonb_build_object('on', v_row.show, 'name', v_row.name);
end; $$;

-- Users with drinks within p_km (5–50, default 20) of the point. Tonight = live rows of tonight
-- (ghost rows never count), position = the pin. Week = nights from Monday (evening date, Europe/Stockholm),
-- position = the night's rough place. Top 10 + the caller. No positions, no ids.
create or replace function public.local_board(p_lat float8, p_lng float8, p_km float8 default 20, p_period text default 'tonight')
returns table(rank int, name text, total int, nights int, is_me boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid    uuid := public.olnu_uid();
  v_period text := lower(btrim(coalesce(p_period, 'tonight')));
  v_km     float8 := least(50, greatest(5, coalesce(nullif(p_km, 'NaN'::float8), 20)));
  v_lat    float8;
  v_lng    float8;
  v_dlat   float8;
  v_week   date := public.olnu_week_start(now());
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if v_period not in ('tonight', 'week') then
    raise exception 'invalid_period';
  end if;
  perform public.olnu_board_rl(v_uid);
  v_lat := round(p_lat::numeric, 2)::float8;
  v_lng := round(p_lng::numeric, 2)::float8;
  v_dlat := v_km / 111.0;

  return query
  with src as (
    select b.user_id as uid, (b.beer_count + coalesce(b.other_count, 0))::int as d, 1 as nn
      from public.beers b
     where v_period = 'tonight'
       and b.expires_at > now() and not coalesce(b.ghost, false)
       and b.beer_count + coalesce(b.other_count, 0) > 0
       and b.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, b.lat, b.lng) <= v_km * 1000
    union all
    select n.user_id, sum(n.drinks)::int, count(*)::int
      from public.board_nights n
     where v_period = 'week'
       and n.drinks > 0
       and public.olnu_evening(n.night) >= v_week
       and n.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, n.lat, n.lng) <= v_km * 1000
     group by n.user_id
  ),
  ranked as (
    select s.uid, s.d, s.nn,
           rank() over (order by s.d desc, s.nn desc)::int as rk,
           row_number() over (order by s.d desc, s.nn desc, s.uid)::int as rn
      from src s
  )
  select r.rk, public.olnu_board_name(r.uid), r.d, r.nn, r.uid = v_uid
    from ranked r
   where r.rn <= 10 or r.uid = v_uid
   order by r.rn;
end; $$;

-- All-time records near the point (radius as local_board). One row per category for the record holder
-- (top = true; ties → who got there first) plus the caller's own value when the caller is not the holder.
-- Categories: best_night (most drinks one night), nights (most nights out), bars (most different bars
-- checked in), stammis (most nights at one bar), skal (skål given), home (nights with "Jag är hemma").
create or replace function public.wall_of_fame(p_lat float8, p_lng float8, p_km float8 default 20)
returns table(category text, name text, value int, is_me boolean, top boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid  uuid := public.olnu_uid();
  v_km   float8 := least(50, greatest(5, coalesce(nullif(p_km, 'NaN'::float8), 20)));
  v_lat  float8;
  v_lng  float8;
  v_dlat float8;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  perform public.olnu_board_rl(v_uid);
  v_lat := round(p_lat::numeric, 2)::float8;
  v_lng := round(p_lng::numeric, 2)::float8;
  v_dlat := v_km / 111.0;

  return query
  with nights as (
    select n.user_id as uid, n.night, n.drinks, n.updated_at
      from public.board_nights n
     where n.drinks > 0
       and n.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, n.lat, n.lng) <= v_km * 1000
  ),
  bars as (
    select x.bar_id from (
      select bl.id as bar_id, bl.lat, bl.lng from public.bars_lite bl
       where bl.lat between v_lat - v_dlat and v_lat + v_dlat
      union
      select bb.bar_id, bb.lat, bb.lng from public.board_bars bb
       where bb.lat between v_lat - v_dlat and v_lat + v_dlat
         and not exists (select 1 from public.bars_lite b2 where b2.id = bb.bar_id)
    ) x
     where public.olnu_dist_m(v_lat, v_lng, x.lat, x.lng) <= v_km * 1000
  ),
  visits as (
    select c.user_id as uid, c.bar_id, c.night from public.medal_checkins c join bars on bars.bar_id = c.bar_id
  ),
  vals as (
    select 'best_night'::text as cat, x.uid, x.drinks::int as v, x.updated_at as at
      from (select distinct on (ni.uid) ni.uid, ni.drinks, ni.updated_at
              from nights ni order by ni.uid, ni.drinks desc, ni.updated_at) x
    union all
    select 'nights', ni.uid, count(*)::int, max(ni.night) from nights ni group by ni.uid
    union all
    select 'bars', vi.uid, count(distinct vi.bar_id)::int, max(vi.night) from visits vi group by vi.uid
    union all
    select 'stammis', s.uid, max(s.k)::int, max(s.last) from (
      select vi.uid, vi.bar_id, count(distinct vi.night) as k, max(vi.night) as last
        from visits vi group by vi.uid, vi.bar_id) s group by s.uid
    union all
    select 'skal', ni.uid, sum(coalesce(an.skal_given, 0))::int, max(ni.night)
      from nights ni join public.after_nights an on an.user_id = ni.uid and an.night = ni.night
     group by ni.uid
    union all
    select 'home', ni.uid,
           count(*) filter (where coalesce(mn.home, false) or an.home_at is not null)::int, max(ni.night)
      from nights ni
      left join public.medal_nights mn on mn.user_id = ni.uid and mn.night = ni.night
      left join public.after_nights an on an.user_id = ni.uid and an.night = ni.night
     group by ni.uid
  ),
  ranked as (
    select va.cat, va.uid, va.v,
           row_number() over (partition by va.cat order by va.v desc, va.at asc nulls last, va.uid) as rn
      from vals va where va.v > 0
  )
  select r.cat, public.olnu_board_name(r.uid), r.v, r.uid = v_uid, r.rn = 1
    from ranked r
   where r.rn = 1 or r.uid = v_uid
   order by array_position(array['best_night', 'nights', 'bars', 'stammis', 'skal', 'home'], r.cat), r.rn;
end; $$;

-- ---------------------------------------------------------------------------
-- G. Backfill: lifetime (sum of week_beers) >= tonight's drinks for every live row. Quiet:
--    the reached titles are claimed in push_sent (no level-up push) and notified_level is set to the
--    current drink level (no late 5/10 push for drinks before v17).
-- ---------------------------------------------------------------------------
insert into public.week_beers as w (user_id, week, n)
select b.user_id, public.olnu_week_start(now()),
       (b.beer_count + coalesce(b.other_count, 0)) - public.olnu_lifetime(b.user_id)
  from public.beers b
 where b.expires_at > now()
   and (b.beer_count + coalesce(b.other_count, 0)) > public.olnu_lifetime(b.user_id)
on conflict (user_id, week) do update set n = w.n + excluded.n;

insert into public.push_sent (user_id, kind, night)
select b.user_id, 'title:' || t.title, '2100-01-01T00:00:00Z'::timestamptz
  from public.beers b
  cross join lateral (select tt.title from public.olnu_titles() tt
                       where tt.at <= public.olnu_lifetime(b.user_id) and tt.at > 0
                       order by tt.at desc limit 1) t
 where b.expires_at > now()
on conflict do nothing;

update public.beers b
   set notified_level = public.olnu_drink_level(b.beer_count + coalesce(b.other_count, 0))
 where b.expires_at > now()
   and b.notified_level < public.olnu_drink_level(b.beer_count + coalesce(b.other_count, 0));

-- ---------------------------------------------------------------------------
-- H. Grants: new RPCs authenticated only; helpers not callable by clients.
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.olnu_world_ok(double precision, double precision)',
    'public.olnu_in_se_box(double precision, double precision)',
    'public.olnu_drink_level(integer)',
    'public.olnu_world_pos_tg()',
    'public.olnu_board_optin_tg()',
    'public.olnu_board_beers_tg()',
    'public.olnu_board_bar_tg()',
    'public.olnu_board_rl(uuid)',
    'public.olnu_board_name(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
  end loop;
  foreach f in array array[
    'public.post_beer_v2(double precision, double precision, boolean, boolean)',
    'public.post_other_v2(text, double precision, double precision, boolean)',
    'public.my_board_optin()',
    'public.set_board_optin(boolean, text)',
    'public.local_board(double precision, double precision, double precision, text)',
    'public.wall_of_fame(double precision, double precision, double precision)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- ===== supabase/migrations/0024_eta.sql =====
-- 0024 v18 ETA ("🏃 Jag é på väg"): a user picks 5/10/15/20/30 min to a bar or a call-out (rally).
-- Group-mates see "🏃 Anton · 7 min" in the bar popup and the rally sheet; mates who are already at
-- the place get a push (notify-group {event:"eta", eta_id}).
-- Additive only. Needs 0001-0011 (beers, groups, rallies, checkins) and olnu_dist_m / olnu_world_ok (0023).
-- Rows are never removed; every read filters on time. Safe to run again.

create table if not exists public.etas (
  id           bigserial primary key,
  user_id      uuid not null,
  group_id     uuid null,                 -- set for a rally ETA: only that group sees it
  bar_id       text null,
  bar_name     text null,
  lat          float8 null,
  lng          float8 null,
  rally_id     bigint null,
  minutes      int not null,
  created_at   timestamptz not null default now(),
  eta_at       timestamptz not null,
  expires_at   timestamptz not null,
  arrived_at   timestamptz null,
  cancelled_at timestamptz null,
  notified     boolean not null default false
);
alter table public.etas enable row level security;
create index if not exists etas_user_idx on public.etas (user_id, created_at desc);
create index if not exists etas_live_idx on public.etas (expires_at);
create index if not exists etas_rally_idx on public.etas (rally_id) where rally_id is not null;

-- One line, no control chars, trimmed, max n chars. Empty -> null.
create or replace function public.olnu_eta_clean(p text, n int)
returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), n), '');
$$;

-- A rally ETA ends with its rally (closed, or expired: 0025 caps rallies at 2 h).
create or replace function public.olnu_eta_rally_ok(e public.etas)
returns boolean language sql stable set search_path = public as $$
  select e.rally_id is null
      or exists (select 1 from public.rallies r where r.id = e.rally_id and not r.closed and r.expires_at > now());
$$;

-- "Live" ETA: tonight, not cancelled, not arrived, not more than 20 min past its time, rally still on.
create or replace function public.olnu_eta_live(e public.etas)
returns boolean language sql stable set search_path = public as $$
  select e.expires_at > now() and e.cancelled_at is null and e.arrived_at is null
     and e.eta_at > now() - interval '20 minutes' and public.olnu_eta_rally_ok(e);
$$;

-- Mark the user's live ETA as arrived when (bar id matches) or (place within 100 m).
create or replace function public.olnu_eta_arrive(p_uid uuid, p_bar_id text, p_lat float8, p_lng float8, p_bar_only boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.etas e set arrived_at = now()
   where e.user_id = p_uid and e.cancelled_at is null and e.arrived_at is null and e.expires_at > now()
     and e.eta_at > now() - interval '20 minutes'
     and (
       (p_bar_id is not null and e.bar_id is not null and e.bar_id = p_bar_id)
       or (
         (not p_bar_only or e.bar_id is null)
         and e.lat is not null and e.lng is not null and p_lat is not null and p_lng is not null
         and public.olnu_dist_m(e.lat, e.lng, p_lat, p_lng) <= 100
       )
     );
end; $$;

-- Check-in at that bar (or within 100 m of a rally place without a bar) -> arrived.
create or replace function public.olnu_eta_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' or new.created_at is distinct from old.created_at or new.bar_id is distinct from old.bar_id then
      perform public.olnu_eta_arrive(new.user_id, new.bar_id, new.lat, new.lng, true);
    end if;
  exception when others then
    null;   -- an ETA bug never blocks a check-in
  end;
  return new;
end; $$;
create or replace trigger olnu_eta_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_eta_checkin_tg();

-- A new drink with a precise, visible pin within 100 m of the target (or snapped to that bar) -> arrived.
create or replace function public.olnu_eta_beer_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if (tg_op = 'INSERT'
        or coalesce(new.beer_count, 0) > coalesce(old.beer_count, 0)
        or coalesce(new.other_count, 0) > coalesce(old.other_count, 0))
       and coalesce(new.precise, false) and not coalesce(new.stopped, false) and not coalesce(new.ghost, false) then
      perform public.olnu_eta_arrive(new.user_id, new.snap_bar, new.lat, new.lng, false);
    end if;
  exception when others then
    null;   -- an ETA bug never blocks a beer
  end;
  return new;
end; $$;
create or replace trigger olnu_eta_beers
  after insert or update on public.beers
  for each row execute function public.olnu_eta_beer_tg();

-- One ETA row as json for the caller.
create or replace function public.olnu_eta_json(e public.etas)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'bar_id', e.bar_id, 'bar_name', e.bar_name, 'lat', e.lat, 'lng', e.lng,
    'rally_id', e.rally_id, 'minutes', e.minutes, 'created_at', e.created_at, 'eta_at', e.eta_at,
    'expires_at', e.expires_at,
    'mins_left', greatest(0, ceil(extract(epoch from (e.eta_at - now())) / 60.0))::int,
    'arrived', e.arrived_at is not null, 'arrived_at', e.arrived_at,
    'active', public.olnu_eta_live(e));
$$;

-- set_eta(bar id, bar name, lat, lng, minutes, rally id?) -> jsonb {ok, wait_seconds, id, eta_at, minutes, ...}
-- Errors: invalid_minutes, invalid_bar, outside_sweden (= invalid coordinates), rally_not_found, not_member.
-- Max 1 new ETA per 2 min per user (ok=false + wait_seconds, nothing changes). A new ETA ends the old one.
create or replace function public.set_eta(p_bar_id text, p_bar_name text, p_lat float8, p_lng float8,
                                          p_minutes int, p_rally_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_bar   text := public.olnu_eta_clean(p_bar_id, 200);
  v_name  text := public.olnu_eta_clean(p_bar_name, 200);
  v_lat   float8; v_lng float8; v_group uuid := null;
  r       public.rallies;
  v_last  timestamptz;
  e       public.etas;
begin
  if p_minutes is null or p_minutes not in (5, 10, 15, 20, 30) then raise exception 'invalid_minutes'; end if;
  if p_rally_id is not null then
    select * into r from public.rallies x where x.id = p_rally_id and not x.closed and x.expires_at > now();
    if not found then raise exception 'rally_not_found'; end if;
    if not exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    v_group := r.group_id;
    if v_bar is not null and char_length(v_bar) > 80 then v_bar := null; end if;
    v_name := left(coalesce(v_name, public.olnu_eta_clean(r.place, 60)), 60);
    if public.olnu_world_ok(p_lat, p_lng) then
      v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
    elsif r.lat is not null and r.lng is not null then
      v_lat := r.lat; v_lng := r.lng;
    end if;
  else
    if v_bar is null or char_length(v_bar) > 80 or v_name is null or char_length(v_name) > 60 then
      raise exception 'invalid_bar';
    end if;
    if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
    v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_eta:' || v_uid::text, 0));
  select max(x.created_at) into v_last from public.etas x where x.user_id = v_uid;
  if v_last is not null and v_last > now() - interval '2 minutes' then
    select * into e from public.etas x where x.user_id = v_uid order by x.created_at desc limit 1;
    return public.olnu_eta_json(e) || jsonb_build_object('ok', false,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + interval '2 minutes' - now())))::int));
  end if;

  update public.etas x set cancelled_at = now()
   where x.user_id = v_uid and x.cancelled_at is null and x.arrived_at is null and x.expires_at > now();

  insert into public.etas (user_id, group_id, bar_id, bar_name, lat, lng, rally_id, minutes, eta_at, expires_at)
  values (v_uid, v_group, v_bar, v_name, v_lat, v_lng, p_rally_id, p_minutes,
          now() + make_interval(mins => p_minutes),
          case when p_rally_id is not null then least(public.olnu_next_expiry(), r.expires_at) else public.olnu_next_expiry() end)
  returning * into e;
  return public.olnu_eta_json(e) || jsonb_build_object('ok', true, 'wait_seconds', 0);
end; $$;

-- cancel_eta(p_arrived default false): ends the caller's live ETA ("Avbryt", or "Framme!" with p_arrived).
-- -> jsonb {ok, id, arrived} / {ok:false, reason:'no_eta'}
create or replace function public.cancel_eta(p_arrived boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint;
begin
  update public.etas x
     set cancelled_at = case when coalesce(p_arrived, false) then x.cancelled_at else now() end,
         arrived_at   = case when coalesce(p_arrived, false) then now() else x.arrived_at end
   where x.id = (select y.id from public.etas y
                  where y.user_id = v_uid and y.cancelled_at is null and y.arrived_at is null and y.expires_at > now()
                  order by y.created_at desc limit 1)
  returning x.id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'no_eta'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'arrived', coalesce(p_arrived, false));
end; $$;

-- my_eta() -> jsonb: the caller's newest ETA tonight that is live or arrived < 15 min ago, else {active:false}.
create or replace function public.my_eta()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  e public.etas;
begin
  select * into e from public.etas x
   where x.user_id = v_uid and x.expires_at > now() and x.cancelled_at is null
     and (public.olnu_eta_live(x) or (x.arrived_at > now() - interval '15 minutes' and public.olnu_eta_rally_ok(x)))
   order by x.created_at desc limit 1;
  if not found then return jsonb_build_object('active', false); end if;
  return public.olnu_eta_json(e);
end; $$;

-- group_etas(): ETAs of the caller and of users who share a group with the caller.
-- A rally ETA (group_id set) is seen only by members of that group. Live rows plus rows that arrived
-- in the last 15 min ("framme!"). name = display name in the shared group (own: smallest own name).
create or replace function public.group_etas()
returns table (id bigint, name text, is_me boolean, bar_id text, bar_name text, lat float8, lng float8,
               rally_id bigint, minutes int, eta_at timestamptz, mins_left int, created_at timestamptz,
               arrived boolean, arrived_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with mine as (select m.group_id, m.display_name from public.group_members m where m.user_id = v_uid)
  select e.id,
         case
           when e.user_id = v_uid then (select min(x.display_name) from mine x)
           when e.group_id is not null then (select gm.display_name from public.group_members gm
                                              where gm.group_id = e.group_id and gm.user_id = e.user_id)
           else (select min(gm.display_name) from public.group_members gm
                  where gm.user_id = e.user_id and gm.group_id in (select x.group_id from mine x))
         end::text,
         e.user_id = v_uid, e.bar_id, e.bar_name, e.lat, e.lng, e.rally_id, e.minutes, e.eta_at,
         greatest(0, ceil(extract(epoch from (e.eta_at - now())) / 60.0))::int, e.created_at,
         e.arrived_at is not null, e.arrived_at
    from public.etas e
   where e.expires_at > now() and e.cancelled_at is null
     and (public.olnu_eta_live(e) or (e.arrived_at > now() - interval '15 minutes' and public.olnu_eta_rally_ok(e)))
     and (
       e.user_id = v_uid
       or (e.group_id is null and exists (
             select 1 from public.group_members gm
              where gm.user_id = e.user_id and gm.group_id in (select x.group_id from mine x)))
       or (e.group_id is not null
           and e.group_id in (select x.group_id from mine x)
           and exists (select 1 from public.group_members gm where gm.group_id = e.group_id and gm.user_id = e.user_id))
     )
   order by e.eta_at
   limit 300;
end; $$;

revoke all on function public.olnu_eta_clean(text, int) from public;
revoke all on function public.olnu_eta_live(public.etas) from public;
revoke all on function public.olnu_eta_rally_ok(public.etas) from public;
revoke all on function public.olnu_eta_arrive(uuid, text, float8, float8, boolean) from public;
revoke all on function public.olnu_eta_checkin_tg() from public;
revoke all on function public.olnu_eta_beer_tg() from public;
revoke all on function public.olnu_eta_json(public.etas) from public;
revoke all on function public.set_eta(text, text, float8, float8, int, bigint) from public;
revoke all on function public.cancel_eta(boolean) from public;
revoke all on function public.my_eta() from public;
revoke all on function public.group_etas() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_eta_clean(text, int), public.olnu_eta_live(public.etas), '
         || 'public.olnu_eta_rally_ok(public.etas), public.olnu_eta_arrive(uuid, text, float8, float8, boolean), public.olnu_eta_checkin_tg(), '
         || 'public.olnu_eta_beer_tg(), public.olnu_eta_json(public.etas), '
         || 'public.set_eta(text, text, float8, float8, int, bigint), public.cancel_eta(boolean), '
         || 'public.my_eta(), public.group_etas() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_eta_clean(text, int), public.olnu_eta_live(public.etas), '
         || 'public.olnu_eta_rally_ok(public.etas), public.olnu_eta_arrive(uuid, text, float8, float8, boolean), public.olnu_eta_checkin_tg(), '
         || 'public.olnu_eta_beer_tg(), public.olnu_eta_json(public.etas) from authenticated';
    execute 'grant execute on function public.set_eta(text, text, float8, float8, int, bigint), '
         || 'public.cancel_eta(boolean), public.my_eta(), public.group_etas() to authenticated';
  end if;
end $$;

-- ===== supabase/migrations/0025_rally_two_hours.sql =====
-- 0025 Call-outs (rallies) end 2 hours after they were made (or at 05:00 if that is earlier).
-- Readers already filter on expires_at > now() (olnu_rally_rows, poll_v2, answer_rally).
create or replace function public.olnu_rally_short_life()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.expires_at := least(coalesce(new.expires_at, now() + interval '2 hours'), coalesce(new.created_at, now()) + interval '2 hours');
  return new;
end;
$$;
revoke all on function public.olnu_rally_short_life() from public, anon, authenticated;
create or replace trigger rallies_short_life before insert on public.rallies
  for each row execute function public.olnu_rally_short_life();
update public.rallies set expires_at = least(expires_at, created_at + interval '2 hours')
 where expires_at > now();

-- ===== supabase/migrations/0026_gang.sql =====
-- 0026 v19 GÄNGET (group fun pack). Client: docs/js/gang.js + docs/js/gang-content.js + docs/gang.css.
-- 1 Citatboken (quote book, revealed 10:00 the next day)   2 Mest troligt (vote a member)
-- 3 Vart ska vi? (bar poll -> call-out via create_rally)    4 Bakisbrunchen (morning brunch call)
-- 5 Kebabtoppen (late-night food ratings, monthly per town) 6 Skuldboken (who owes whom + Swish number)
-- 7 Morgontidningen (facts of the group's last night for a fake tabloid page, drawn by the client)
-- Additive only. Needs 0001-0025 (groups, group_msgs, rallies + create_rally, medal_nights, medal_checkins,
-- after_nights, bars_lite, olnu_towns, etas, bar_takeovers). Rows are never removed; reads filter on time.
-- RLS on, no policies. All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), authenticated only.
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.gang_quotes (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,                       -- who saved it
  who         text not null check (char_length(who) between 1 and 30),
  body        text not null check (char_length(body) between 1 and 140),
  msg_id      bigint null,
  night       timestamptz not null,
  reveal_at   timestamptz not null,
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false,
  hidden_by   uuid null,
  hidden_at   timestamptz null
);
create index if not exists gang_quotes_group_idx on public.gang_quotes (group_id, id desc);
create index if not exists gang_quotes_user_idx on public.gang_quotes (user_id, created_at desc);

create table if not exists public.gang_mt_rounds (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,                       -- who started it
  q           int not null check (q between 0 and 9999),
  night       timestamptz not null,
  created_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  closed_at   timestamptz null
);
create index if not exists gang_mt_rounds_group_idx on public.gang_mt_rounds (group_id, night, id desc);
create index if not exists gang_mt_rounds_user_idx on public.gang_mt_rounds (user_id, created_at desc);

create table if not exists public.gang_mt_votes (
  round_id    bigint not null,
  voter       uuid not null,
  target      uuid not null,
  updated_at  timestamptz not null default now(),
  primary key (round_id, voter)
);

create table if not exists public.gang_polls (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,
  night       timestamptz not null,
  options     jsonb not null,                      -- [{id, name, lat, lng}] 2-4
  created_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  ended_at    timestamptz null,
  ended_by    uuid null,
  winner      int null,
  rally_id    bigint null,
  rally_error text null
);
create index if not exists gang_polls_group_idx on public.gang_polls (group_id, id desc);
create index if not exists gang_polls_user_idx on public.gang_polls (user_id, created_at desc);

create table if not exists public.gang_poll_votes (
  poll_id     bigint not null,
  user_id     uuid not null,
  opt         int not null check (opt between 0 and 3),
  updated_at  timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists public.gang_brunches (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,
  place       text not null check (char_length(place) between 1 and 60),
  place_id    text null,
  lat         float8 null,
  lng         float8 null,
  at_time     text null,                           -- 'HH:MM' or null (= nu)
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  closed      boolean not null default false
);
create index if not exists gang_brunches_group_idx on public.gang_brunches (group_id, id desc);
create index if not exists gang_brunches_user_idx on public.gang_brunches (user_id, created_at desc);

create table if not exists public.gang_brunch_answers (
  brunch_id   bigint not null,
  user_id     uuid not null,
  answer      text not null check (answer in ('ja', 'kanske', 'nej')),
  updated_at  timestamptz not null default now(),
  primary key (brunch_id, user_id)
);

create table if not exists public.kebab_ratings (
  id          bigserial primary key,
  user_id     uuid not null,
  place_id    text not null check (char_length(place_id) between 1 and 80),
  place_name  text not null check (char_length(place_name) between 1 and 60),
  lat         float8 not null,
  lng         float8 not null,
  town        text not null,
  stars       int not null check (stars between 1 and 5),
  tag         text null,
  night       timestamptz not null,
  month       date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, place_id, night)
);
create index if not exists kebab_ratings_town_idx on public.kebab_ratings (town, month);
create index if not exists kebab_ratings_place_idx on public.kebab_ratings (place_id, month);
create index if not exists kebab_ratings_user_idx on public.kebab_ratings (user_id, updated_at desc);

create table if not exists public.gang_debts (
  id           bigserial primary key,
  group_id     uuid not null,
  created_by   uuid not null,
  debtor       uuid not null,
  creditor     uuid not null,
  amount       int not null check (amount between 1 and 50000),
  what         text not null check (char_length(what) between 1 and 40),
  created_at   timestamptz not null default now(),
  paid_at      timestamptz null,
  paid_by      uuid null,
  cancelled_at timestamptz null,
  cancelled_by uuid null
);
create index if not exists gang_debts_group_idx on public.gang_debts (group_id, id desc);
create index if not exists gang_debts_user_idx on public.gang_debts (created_by, created_at desc);

create table if not exists public.gang_swish (
  group_id    uuid not null,
  user_id     uuid not null,
  number      text null,
  changes     int not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.gang_quotes         enable row level security;
alter table public.gang_mt_rounds      enable row level security;
alter table public.gang_mt_votes       enable row level security;
alter table public.gang_polls          enable row level security;
alter table public.gang_poll_votes     enable row level security;
alter table public.gang_brunches       enable row level security;
alter table public.gang_brunch_answers enable row level security;
alter table public.kebab_ratings       enable row level security;
alter table public.gang_debts          enable row level security;
alter table public.gang_swish          enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
-- One line, no control chars, spaces squeezed, trimmed. Empty -> ''.
create or replace function public.olnu_gang_clean(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- Opaque member key (never a user id).
create or replace function public.olnu_gang_k(p_group uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-gang'), 1, 12);
$$;

create or replace function public.olnu_gang_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$$;

-- Member user id from key, or null.
create or replace function public.olnu_gang_uid_of(p_group uuid, p_k text)
returns uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.group_members m
   where m.group_id = p_group and public.olnu_gang_k(p_group, m.user_id) = p_k limit 1;
$$;

create or replace function public.olnu_gang_name(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid;
$$;

-- The night that ended last (the 05:00 boundary at or before now), DST-correct.
create or replace function public.olnu_gang_last_night()
returns timestamptz language sql stable set search_path = public as $$
  select ((public.olnu_night_of(now()) at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$$;

-- 10:00 Europe/Stockholm on the day the night ends.
create or replace function public.olnu_gang_reveal(p_night timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select (((p_night at time zone 'Europe/Stockholm')::date + time '10:00') at time zone 'Europe/Stockholm');
$$;

create or replace function public.olnu_gang_hour()
returns int language sql stable set search_path = public as $$
  select extract(hour from (now() at time zone 'Europe/Stockholm'))::int;
$$;

-- Town key for kebab lists: the nearest known town (~30 km), else a ~50 km cell.
create or replace function public.olnu_gang_town(p_lat float8, p_lng float8)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(public.olnu_town_of(p_lat, p_lng),
                  '~' || (round(p_lat::numeric * 2) / 2)::text || ':' || (round(p_lng::numeric))::text);
$$;

create or replace function public.olnu_gang_rl(p_key text)
returns void language sql set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('olnu_gang:' || p_key, 0));
$$;

-- Mest troligt: a round is open while not closed, not past ends_at, and not everyone (current members) voted.
create or replace function public.olnu_gang_mt_done(r public.gang_mt_rounds)
returns boolean language sql stable security definer set search_path = public as $$
  select r.closed_at is not null or r.ends_at <= now()
      or (select count(*) from public.gang_mt_votes v
            join public.group_members m on m.group_id = r.group_id and m.user_id = v.voter
           where v.round_id = r.id)
         >= greatest(2, (select count(*) from public.group_members m where m.group_id = r.group_id));
$$;

create or replace function public.olnu_gang_mt_json(r public.gang_mt_rounds, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with votes as (
    select v.voter, v.target from public.gang_mt_votes v
      join public.group_members m on m.group_id = r.group_id and m.user_id = v.voter
      join public.group_members t on t.group_id = r.group_id and t.user_id = v.target
     where v.round_id = r.id
  ), res as (
    select v.target, count(*)::int as n from votes v group by v.target
  )
  select jsonb_build_object(
    'id', r.id, 'q', r.q, 'created_at', r.created_at, 'ends_at', r.ends_at,
    'by', public.olnu_gang_name(r.group_id, r.user_id), 'by_me', r.user_id = p_uid,
    'votes', (select count(*) from votes)::int,
    'needed', greatest(2, (select count(*) from public.group_members m where m.group_id = r.group_id))::int,
    'my_vote', (select public.olnu_gang_k(r.group_id, v.target) from votes v where v.voter = p_uid),
    'done', public.olnu_gang_mt_done(r),
    'results', case when public.olnu_gang_mt_done(r) then coalesce((
        select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(r.group_id, x.target),
                                            'name', public.olnu_gang_name(r.group_id, x.target),
                                            'is_me', x.target = p_uid, 'n', x.n) order by x.n desc, public.olnu_gang_name(r.group_id, x.target))
          from res x), '[]'::jsonb) else null end);
$$;

create or replace function public.olnu_gang_poll_json(p public.gang_polls, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with votes as (
    select v.user_id, v.opt, v.updated_at from public.gang_poll_votes v
      join public.group_members m on m.group_id = p.group_id and m.user_id = v.user_id
     where v.poll_id = p.id
  )
  select jsonb_build_object(
    'id', p.id, 'by', public.olnu_gang_name(p.group_id, p.user_id), 'by_me', p.user_id = p_uid,
    'created_at', p.created_at, 'ends_at', p.ends_at,
    'ended', p.ended_at is not null or p.ends_at <= now(), 'ended_at', coalesce(p.ended_at, case when p.ends_at <= now() then p.ends_at end),
    'winner', p.winner, 'rally_id', p.rally_id, 'rally_error', p.rally_error,
    'rally_mine', exists (select 1 from public.rallies r where r.id = p.rally_id and r.user_id = p_uid),
    'my_vote', (select v.opt from votes v where v.user_id = p_uid),
    'votes', (select count(*) from votes)::int,
    'options', coalesce((
      select jsonb_agg(o.value || jsonb_build_object(
               'i', (o.ord - 1)::int,
               'n', (select count(*) from votes v where v.opt = o.ord - 1)::int,
               'names', coalesce((select jsonb_agg(public.olnu_gang_name(p.group_id, v.user_id) order by v.updated_at)
                                    from votes v where v.opt = o.ord - 1), '[]'::jsonb)) order by o.ord)
        from jsonb_array_elements(p.options) with ordinality o(value, ord)), '[]'::jsonb));
$$;

-- Winner of a poll: most votes (current members); tie -> the option that reached that count first
-- (earliest last vote among tied); no votes -> null.
create or replace function public.olnu_gang_poll_winner(p public.gang_polls)
returns int language sql stable security definer set search_path = public as $$
  select v.opt from public.gang_poll_votes v
    join public.group_members m on m.group_id = p.group_id and m.user_id = v.user_id
   where v.poll_id = p.id
   group by v.opt
   order by count(*) desc, max(v.updated_at), v.opt
   limit 1;
$$;

-- End a poll (lock held by caller). Picks the winner and makes the call-out with create_rally as the caller.
create or replace function public.olnu_gang_poll_finish(p_id bigint, p_uid uuid)
returns public.gang_polls language plpgsql security definer set search_path = public as $$
declare
  p public.gang_polls;
  w int;
  o jsonb;
  r json;
  v_rally bigint := null;
  v_err text := null;
begin
  select * into p from public.gang_polls x where x.id = p_id for update;
  if p.ended_at is not null then return p; end if;
  w := public.olnu_gang_poll_winner(p);
  if w is not null then
    o := p.options -> w;
    begin
      r := public.create_rally(p.group_id, left('🗳️ Gänget har röstat: ' || (o ->> 'name') || '!', 100),
                               left(o ->> 'name', 60), (o ->> 'lat')::float8, (o ->> 'lng')::float8);
      v_rally := (r ->> 'id')::bigint;
    exception when others then
      v_err := left(sqlerrm, 40);   -- e.g. slow_down: the result still shows, the app offers the call-out button
    end;
  end if;
  update public.gang_polls x
     set ended_at = now(), ended_by = p_uid, winner = w, rally_id = v_rally, rally_error = v_err
   where x.id = p_id
  returning * into p;
  return p;
end; $$;

create or replace function public.olnu_gang_brunch_json(b public.gang_brunches, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with a as (
    select x.user_id, x.answer, x.updated_at from public.gang_brunch_answers x
      join public.group_members m on m.group_id = b.group_id and m.user_id = x.user_id
     where x.brunch_id = b.id
  )
  select jsonb_build_object(
    'id', b.id, 'by', public.olnu_gang_name(b.group_id, b.user_id), 'by_me', b.user_id = p_uid,
    'place', b.place, 'place_id', b.place_id, 'lat', b.lat, 'lng', b.lng, 'at_time', b.at_time,
    'created_at', b.created_at, 'expires_at', b.expires_at,
    'mine', (select a.answer from a where a.user_id = p_uid),
    'ja', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.user_id <> b.user_id, a.updated_at) from a where a.answer = 'ja'), '[]'::jsonb),
    'kanske', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.updated_at) from a where a.answer = 'kanske'), '[]'::jsonb),
    'nej', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.updated_at) from a where a.answer = 'nej'), '[]'::jsonb));
$$;

-- Open debts between current members only. Net per member: + = gets money, - = owes.
create or replace function public.olnu_gang_debts_json(p_group uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with mem as (select m.user_id, m.display_name from public.group_members m where m.group_id = p_group),
  open as (
    select d.* from public.gang_debts d
     where d.group_id = p_group and d.paid_at is null and d.cancelled_at is null
       and d.debtor in (select user_id from mem) and d.creditor in (select user_id from mem)
  ),
  paid as (
    select d.* from public.gang_debts d
     where d.group_id = p_group and d.paid_at is not null and d.cancelled_at is null and d.paid_at > now() - interval '14 days'
     order by d.paid_at desc limit 10
  ),
  net as (
    select u.user_id, sum(u.amt)::int as net from (
      select o.creditor as user_id, o.amount as amt from open o
      union all select o.debtor, -o.amount from open o) u group by u.user_id
  )
  select jsonb_build_object(
    'open', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'amount', o.amount, 'what', o.what, 'created_at', o.created_at,
        'debtor', public.olnu_gang_k(p_group, o.debtor), 'debtor_name', public.olnu_gang_name(p_group, o.debtor),
        'creditor', public.olnu_gang_k(p_group, o.creditor), 'creditor_name', public.olnu_gang_name(p_group, o.creditor),
        'by', public.olnu_gang_name(p_group, o.created_by),
        'i_owe', o.debtor = p_uid, 'owed_me', o.creditor = p_uid,
        'can_cancel', o.created_by = p_uid or o.creditor = p_uid) order by o.id desc) from open o), '[]'::jsonb),
    'paid', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'amount', o.amount, 'what', o.what, 'paid_at', o.paid_at,
        'debtor_name', public.olnu_gang_name(p_group, o.debtor), 'creditor_name', public.olnu_gang_name(p_group, o.creditor),
        'can_undo', (o.debtor = p_uid or o.creditor = p_uid or o.created_by = p_uid) and o.paid_at > now() - interval '1 day')
        order by o.paid_at desc) from paid o), '[]'::jsonb),
    'net', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group, n.user_id),
        'name', public.olnu_gang_name(p_group, n.user_id), 'is_me', n.user_id = p_uid, 'net', n.net) order by n.net desc)
        from net n where n.net <> 0), '[]'::jsonb),
    'swish', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group, s.user_id),
        'name', public.olnu_gang_name(p_group, s.user_id), 'is_me', s.user_id = p_uid, 'number', s.number))
        from public.gang_swish s where s.group_id = p_group and s.number is not null
         and s.user_id in (select user_id from mem)), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- 1. Citatboken
-- ---------------------------------------------------------------------------
-- add_quote(group, who, body, msg_id?) -> {id, reveal_at, who, body}
-- With a msg_id of a live message in this group: who = sender's name, body = the message (client values ignored).
create or replace function public.add_quote(p_group_id uuid, p_who text, p_body text, p_msg_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_who text := public.olnu_gang_clean(p_who);
  v_body text := public.olnu_gang_clean(p_body);
  v_night timestamptz := public.olnu_night_of(now());
  m public.group_msgs;
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_msg_id is not null then
    select * into m from public.group_msgs x where x.id = p_msg_id and x.group_id = p_group_id;
    if found then
      v_body := public.olnu_gang_clean(m.body);
      v_who := coalesce(public.olnu_gang_name(p_group_id, m.user_id), v_who);
    end if;
  end if;
  v_body := btrim(v_body, ' "”“');
  if v_who = '' or char_length(v_who) > 30 or v_body = '' or char_length(v_body) > 140 then raise exception 'invalid_quote'; end if;
  perform public.olnu_gang_rl('q:' || v_uid::text);
  if exists (select 1 from public.gang_quotes q where q.user_id = v_uid and q.created_at > now() - interval '8 seconds') then
    raise exception 'slow_down';
  end if;
  if (select count(*) from public.gang_quotes q where q.user_id = v_uid and q.night = v_night) >= 40 then
    raise exception 'slow_down';
  end if;
  -- Same quote twice tonight in this group -> the old row.
  select q.id into v_id from public.gang_quotes q
   where q.group_id = p_group_id and q.night = v_night and lower(q.body) = lower(v_body) and lower(q.who) = lower(v_who) and not q.hidden
   limit 1;
  if v_id is null then
    insert into public.gang_quotes (group_id, user_id, who, body, msg_id, night, reveal_at)
    values (p_group_id, v_uid, v_who, v_body, case when m.id is not null then m.id end, v_night, public.olnu_gang_reveal(v_night))
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'reveal_at', public.olnu_gang_reveal(v_night), 'who', v_who, 'body', v_body);
end; $$;

-- hide_quote(id): the saver, or a member whose display name equals "who" (the quoted person). Not undone.
create or replace function public.hide_quote(p_quote_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  q public.gang_quotes;
begin
  select * into q from public.gang_quotes x where x.id = p_quote_id;
  if not found or not public.olnu_gang_member(q.group_id, v_uid) then raise exception 'quote_not_found'; end if;
  if q.user_id <> v_uid and lower(coalesce(public.olnu_gang_name(q.group_id, v_uid), '')) <> lower(q.who) then
    raise exception 'not_yours';
  end if;
  update public.gang_quotes x set hidden = true, hidden_by = v_uid, hidden_at = now() where x.id = q.id;
  return jsonb_build_object('ok', true);
end; $$;

-- gang_quotes(group, before_id?) -> setof rows, newest first, max 30: revealed quotes + the caller's own pending ones.
create or replace function public.gang_quotes(p_group_id uuid, p_before_id bigint default null)
returns table (id bigint, who text, body text, by_name text, by_me boolean, created_at timestamptz, night timestamptz,
               reveal_at timestamptz, revealed boolean, can_hide boolean)
language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_me text;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_me := lower(coalesce(public.olnu_gang_name(p_group_id, v_uid), ''));
  return query
  select q.id, q.who, q.body, public.olnu_gang_name(q.group_id, q.user_id), q.user_id = v_uid, q.created_at, q.night,
         q.reveal_at, q.reveal_at <= now(), q.user_id = v_uid or lower(q.who) = v_me
    from public.gang_quotes q
   where q.group_id = p_group_id and not q.hidden
     and (q.reveal_at <= now() or q.user_id = v_uid)
     and (p_before_id is null or q.id < p_before_id)
   order by q.id desc
   limit 30;
end; $$;

-- ---------------------------------------------------------------------------
-- 2. Mest troligt
-- ---------------------------------------------------------------------------
-- mt_start(group, n = number of questions in the client list) -> {id, q}
-- One open round per group (round_open). Needs 2+ members (not_enough). 1 start per 15 s per user.
-- q = random index < n, not used by the group in the last 30 days when possible.
create or replace function public.mt_start(p_group_id uuid, p_n int default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_n int := least(greatest(coalesce(p_n, 120), 1), 10000);
  r public.gang_mt_rounds;
  v_q int;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if (select count(*) from public.group_members m where m.group_id = p_group_id) < 2 then raise exception 'not_enough'; end if;
  perform public.olnu_gang_rl('mt:' || p_group_id::text);
  for r in select * from public.gang_mt_rounds x where x.group_id = p_group_id and x.closed_at is null and x.ends_at > now() loop
    if not public.olnu_gang_mt_done(r) then raise exception 'round_open'; end if;
  end loop;
  if exists (select 1 from public.gang_mt_rounds x where x.user_id = v_uid and x.created_at > now() - interval '15 seconds') then
    raise exception 'slow_down';
  end if;
  select g.i into v_q from generate_series(0, v_n - 1) g(i)
   where g.i not in (select x.q from public.gang_mt_rounds x where x.group_id = p_group_id and x.created_at > now() - interval '30 days')
   order by random() limit 1;
  if v_q is null then v_q := floor(random() * v_n)::int; end if;
  insert into public.gang_mt_rounds (group_id, user_id, q, night, ends_at)
  values (p_group_id, v_uid, v_q, public.olnu_night_of(now()), now() + interval '10 minutes')
  returning * into r;
  return jsonb_build_object('id', r.id, 'q', r.q);
end; $$;

-- mt_vote(round, member key) -> round json. Change allowed until the round is done.
create or replace function public.mt_vote(p_round_id bigint, p_member text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.gang_mt_rounds;
  v_t uuid;
begin
  select * into r from public.gang_mt_rounds x where x.id = p_round_id;
  if not found or not public.olnu_gang_member(r.group_id, v_uid) then raise exception 'round_not_found'; end if;
  if public.olnu_gang_mt_done(r) then raise exception 'round_done'; end if;
  v_t := public.olnu_gang_uid_of(r.group_id, p_member);
  if v_t is null then raise exception 'invalid_member'; end if;
  insert into public.gang_mt_votes (round_id, voter, target) values (r.id, v_uid, v_t)
  on conflict (round_id, voter) do update set target = excluded.target, updated_at = now();
  return public.olnu_gang_mt_json(r, v_uid);
end; $$;

-- mt_close(round): the starter ends it now (results show).
create or replace function public.mt_close(p_round_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.gang_mt_rounds;
begin
  update public.gang_mt_rounds x set closed_at = coalesce(x.closed_at, now())
   where x.id = p_round_id and x.user_id = v_uid
  returning * into r;
  if not found then raise exception 'round_not_found'; end if;
  return public.olnu_gang_mt_json(r, v_uid);
end; $$;

-- ---------------------------------------------------------------------------
-- 3. Vart ska vi?
-- ---------------------------------------------------------------------------
-- create_bar_poll(group, options jsonb [{id, name, lat, lng}] 2-4 distinct) -> {id, ends_at}
create or replace function public.create_bar_poll(p_group_id uuid, p_options jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_opts jsonb := '[]'::jsonb;
  o jsonb;
  v_id text; v_name text; v_lat float8; v_lng float8;
  p public.gang_polls;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 4 then
    raise exception 'invalid_poll';
  end if;
  for o in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(o) <> 'object' then raise exception 'invalid_poll'; end if;
    v_id := public.olnu_gang_clean(o ->> 'id');
    v_name := public.olnu_gang_clean(o ->> 'name');
    begin
      v_lat := (o ->> 'lat')::float8; v_lng := (o ->> 'lng')::float8;
    exception when others then raise exception 'invalid_poll';
    end;
    if v_id = '' or char_length(v_id) > 80 or v_name = '' or char_length(v_name) > 60 or not public.olnu_world_ok(v_lat, v_lng) then
      raise exception 'invalid_poll';
    end if;
    if exists (select 1 from jsonb_array_elements(v_opts) e where e.value ->> 'id' = v_id) then raise exception 'invalid_poll'; end if;
    v_opts := v_opts || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name,
                'lat', round(v_lat::numeric, 5)::float8, 'lng', round(v_lng::numeric, 5)::float8));
  end loop;
  perform public.olnu_gang_rl('poll:' || p_group_id::text);
  -- An open poll past its 15 min is finished first (its winner becomes the call-out).
  for p in select * from public.gang_polls x where x.group_id = p_group_id and x.ended_at is null loop
    if p.ends_at > now() then raise exception 'poll_open'; end if;
    perform public.olnu_gang_poll_finish(p.id, v_uid);
  end loop;
  if exists (select 1 from public.gang_polls x where x.user_id = v_uid and x.created_at > now() - interval '2 minutes') then
    raise exception 'slow_down';
  end if;
  insert into public.gang_polls (group_id, user_id, night, options, ends_at)
  values (p_group_id, v_uid, public.olnu_night_of(now()), v_opts, now() + interval '15 minutes')
  returning * into p;
  -- The creator votes like everyone else (no automatic vote).
  return jsonb_build_object('id', p.id, 'ends_at', p.ends_at);
end; $$;

-- vote_bar_poll(poll, option 0-3) -> poll json. Change allowed until the end.
create or replace function public.vote_bar_poll(p_poll_id bigint, p_option int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  p public.gang_polls;
begin
  select * into p from public.gang_polls x where x.id = p_poll_id;
  if not found or not public.olnu_gang_member(p.group_id, v_uid) then raise exception 'poll_not_found'; end if;
  if p.ended_at is not null or p.ends_at <= now() then raise exception 'poll_ended'; end if;
  if p_option is null or p_option < 0 or p_option >= jsonb_array_length(p.options) then raise exception 'invalid_option'; end if;
  insert into public.gang_poll_votes (poll_id, user_id, opt) values (p.id, v_uid, p_option)
  on conflict (poll_id, user_id) do update set opt = excluded.opt, updated_at = now();
  return public.olnu_gang_poll_json(p, v_uid);
end; $$;

-- end_bar_poll(poll): the creator any time; any member after the 15 min. Idempotent.
-- Winner -> create_rally (as the caller): body "🗳️ Gänget har röstat: <bar>!", place + position of the bar.
-- -> poll json (+ fields winner, rally_id, rally_error).
create or replace function public.end_bar_poll(p_poll_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  p public.gang_polls;
begin
  select * into p from public.gang_polls x where x.id = p_poll_id;
  if not found or not public.olnu_gang_member(p.group_id, v_uid) then raise exception 'poll_not_found'; end if;
  if p.ended_at is null then
    if p.user_id <> v_uid and p.ends_at > now() then raise exception 'not_yours'; end if;
    perform public.olnu_gang_rl('poll:' || p.group_id::text);
    p := public.olnu_gang_poll_finish(p.id, v_uid);
  end if;
  return public.olnu_gang_poll_json(p, v_uid);
end; $$;

-- ---------------------------------------------------------------------------
-- 4. Bakisbrunchen
-- ---------------------------------------------------------------------------
-- create_brunch(group, place, place_id?, lat?, lng?, at 'HH:MM'?) -> {id}
-- Only 06:00-13:59 Europe/Stockholm (not_morning). Lives until 16:00 today (at least 2 h). One open brunch per group:
-- the caller's own older one is replaced; someone else's -> brunch_open. 1 new per 2 min per user.
create or replace function public.create_brunch(p_group_id uuid, p_place text, p_place_id text default null,
                                                p_lat float8 default null, p_lng float8 default null, p_at text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_place text := public.olnu_gang_clean(p_place);
  v_pid text := nullif(public.olnu_gang_clean(p_place_id), '');
  v_at text := nullif(public.olnu_gang_clean(p_at), '');
  v_h int := public.olnu_gang_hour();
  v_lat float8; v_lng float8;
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_h < 6 or v_h >= 14 then raise exception 'not_morning'; end if;
  if v_place = '' or char_length(v_place) > 60 or (v_pid is not null and char_length(v_pid) > 80)
     or (v_at is not null and v_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'invalid_brunch';
  end if;
  if public.olnu_world_ok(p_lat, p_lng) then v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8; end if;
  perform public.olnu_gang_rl('brunch:' || p_group_id::text);
  if exists (select 1 from public.gang_brunches b where b.user_id = v_uid and b.created_at > now() - interval '2 minutes') then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from public.gang_brunches b where b.group_id = p_group_id and not b.closed and b.expires_at > now() and b.user_id <> v_uid) then
    raise exception 'brunch_open';
  end if;
  update public.gang_brunches b set closed = true where b.group_id = p_group_id and b.user_id = v_uid and not b.closed;
  insert into public.gang_brunches (group_id, user_id, place, place_id, lat, lng, at_time, expires_at)
  values (p_group_id, v_uid, v_place, v_pid, v_lat, v_lng, v_at,
          greatest((((now() at time zone 'Europe/Stockholm')::date + time '16:00') at time zone 'Europe/Stockholm'),
                   now() + interval '2 hours'))
  returning id into v_id;
  insert into public.gang_brunch_answers (brunch_id, user_id, answer) values (v_id, v_uid, 'ja');
  return jsonb_build_object('id', v_id);
end; $$;

-- answer_brunch(brunch, 'ja'|'kanske'|'nej') -> brunch json
create or replace function public.answer_brunch(p_brunch_id bigint, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_answer, '')));
  b public.gang_brunches;
begin
  if v_a not in ('ja', 'kanske', 'nej') then raise exception 'invalid_answer'; end if;
  select * into b from public.gang_brunches x where x.id = p_brunch_id and not x.closed and x.expires_at > now();
  if not found or not public.olnu_gang_member(b.group_id, v_uid) then raise exception 'brunch_not_found'; end if;
  insert into public.gang_brunch_answers (brunch_id, user_id, answer) values (b.id, v_uid, v_a)
  on conflict (brunch_id, user_id) do update set answer = excluded.answer, updated_at = now();
  return public.olnu_gang_brunch_json(b, v_uid);
end; $$;

-- close_brunch(brunch): the creator ends it.
create or replace function public.close_brunch(p_brunch_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id bigint;
begin
  update public.gang_brunches x set closed = true where x.id = p_brunch_id and x.user_id = v_uid returning x.id into v_id;
  if v_id is null then raise exception 'brunch_not_found'; end if;
  return jsonb_build_object('ok', true);
end; $$;

-- ---------------------------------------------------------------------------
-- 5. Kebabtoppen (food only)
-- ---------------------------------------------------------------------------
-- rate_kebab(place id, name, place lat/lng, stars 1-5, tag?, my lat/lng) -> {ok, is_new, avg, n, town}
-- Place: a bars_lite row of type fast_food/restaurant, or a "pl_" place id (places tiles). Bars/pubs -> not_food.
-- Caller within 2 km of the place (too_far). One rating per place per night (a second call changes it).
-- 1 call per 5 s per user (slow_down). Tags: whitelist below.
create or replace function public.rate_kebab(p_place_id text, p_name text, p_lat float8, p_lng float8, p_stars int,
                                             p_tag text default null, p_my_lat float8 default null, p_my_lng float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_pid text := public.olnu_gang_clean(p_place_id);
  v_name text := public.olnu_gang_clean(p_name);
  v_tag text := nullif(lower(public.olnu_gang_clean(p_tag)), '');
  v_night timestamptz := public.olnu_night_of(now());
  v_month date := date_trunc('month', now() at time zone 'Europe/Stockholm')::date;
  bl public.bars_lite;
  v_town text;
  v_new boolean;
  v_avg numeric; v_n int;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'invalid_stars'; end if;
  if v_tag is not null and v_tag not in ('sas', 'storst', 'snabbast', 'krispigast', 'trevligast', 'prisvard', 'starkast', 'raddare') then
    raise exception 'invalid_tag';
  end if;
  if v_pid = '' or char_length(v_pid) > 80 then raise exception 'invalid_place'; end if;
  select * into bl from public.bars_lite b where b.id = v_pid;
  if found then
    if coalesce(bl.type, '') not in ('fast_food', 'restaurant') then raise exception 'not_food'; end if;
    p_lat := bl.lat; p_lng := bl.lng;
    v_name := coalesce(nullif(public.olnu_gang_clean(bl.name), ''), v_name);
  elsif v_pid !~ '^pl_-?[0-9]+_-?[0-9]+$' then
    raise exception 'not_food';
  end if;
  v_name := left(v_name, 60);
  if v_name = '' or not public.olnu_world_ok(p_lat, p_lng) then raise exception 'invalid_place'; end if;
  if not public.olnu_world_ok(p_my_lat, p_my_lng) or public.olnu_dist_m(p_lat, p_lng, p_my_lat, p_my_lng) > 2000 then
    raise exception 'too_far';
  end if;
  perform public.olnu_gang_rl('kebab:' || v_uid::text);
  if exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.updated_at > now() - interval '5 seconds') then
    raise exception 'slow_down';
  end if;
  v_town := public.olnu_gang_town(p_lat, p_lng);
  v_new := not exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.place_id = v_pid and k.night = v_night);
  insert into public.kebab_ratings (user_id, place_id, place_name, lat, lng, town, stars, tag, night, month)
  values (v_uid, v_pid, v_name, round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8, v_town, p_stars, v_tag, v_night, v_month)
  on conflict (user_id, place_id, night) do update set stars = excluded.stars, tag = excluded.tag, updated_at = now();
  select round(avg(x.stars)::numeric, 2), count(*)::int into v_avg, v_n
    from (select distinct on (k.user_id) k.stars from public.kebab_ratings k
           where k.place_id = v_pid and k.month = v_month order by k.user_id, k.updated_at desc) x;
  return jsonb_build_object('ok', true, 'is_new', v_new, 'avg', v_avg, 'n', v_n,
                            'town', case when left(v_town, 1) = '~' then null else v_town end);
end; $$;

-- kebab_top(lat, lng, month_offset 0|1) -> {town, month, list:[{rank, place_id, name, lat, lng, avg, n, tag, my_stars}]}
-- Town of the given point; this month (or last month). One vote per user per place per month (the latest).
-- Rank: avg desc, n desc, first rating. Top 10.
create or replace function public.kebab_top(p_lat float8, p_lng float8, p_month_offset int default 0)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_town text;
  v_month date := (date_trunc('month', now() at time zone 'Europe/Stockholm')
                   - make_interval(months => least(greatest(coalesce(p_month_offset, 0), 0), 12)))::date;
  v_list jsonb;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_town := public.olnu_gang_town(p_lat, p_lng);
  with latest as (
    select distinct on (k.user_id, k.place_id) k.* from public.kebab_ratings k
     where k.town = v_town and k.month = v_month
     order by k.user_id, k.place_id, k.updated_at desc
  ), agg as (
    select l.place_id, max(l.place_name) as name, avg(l.lat) as lat, avg(l.lng) as lng,
           round(avg(l.stars)::numeric, 2) as avg, count(*)::int as n, min(l.created_at) as first_at,
           (select l2.tag from latest l2 where l2.place_id = l.place_id and l2.tag is not null
             group by l2.tag order by count(*) desc, l2.tag limit 1) as tag,
           max(case when l.user_id = v_uid then l.stars end) as my_stars
      from latest l group by l.place_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', x.rk, 'place_id', x.place_id, 'name', x.name, 'lat', x.lat, 'lng', x.lng,
           'avg', x.avg, 'n', x.n, 'tag', x.tag, 'my_stars', x.my_stars) order by x.rk), '[]'::jsonb)
    into v_list
    from (select a.*, row_number() over (order by a.avg desc, a.n desc, a.first_at)::int as rk from agg a) x
   where x.rk <= 10;
  return jsonb_build_object('town', case when left(v_town, 1) = '~' then null else v_town end,
                            'month', v_month, 'list', v_list);
end; $$;

-- kebab_place(place id) -> {avg, n, my_stars, my_tag, rated_tonight, tags:[{tag, n}]} (this month)
create or replace function public.kebab_place(p_place_id text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_month date := date_trunc('month', now() at time zone 'Europe/Stockholm')::date;
  v_night timestamptz := public.olnu_night_of(now());
  r jsonb;
begin
  with latest as (
    select distinct on (k.user_id) k.* from public.kebab_ratings k
     where k.place_id = p_place_id and k.month = v_month order by k.user_id, k.updated_at desc
  )
  select jsonb_build_object(
    'avg', (select round(avg(l.stars)::numeric, 2) from latest l),
    'n', (select count(*) from latest l)::int,
    'my_stars', (select l.stars from latest l where l.user_id = v_uid),
    'my_tag', (select l.tag from latest l where l.user_id = v_uid),
    'rated_tonight', exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.place_id = p_place_id and k.night = v_night),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc)
                       from (select l.tag, count(*)::int n from latest l where l.tag is not null group by l.tag) t), '[]'::jsonb))
    into r;
  return r;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. Skuldboken
-- ---------------------------------------------------------------------------
-- add_debt(group, debtor key, creditor key, amount kr 1-50000, what 1-40) -> {id}
create or replace function public.add_debt(p_group_id uuid, p_debtor text, p_creditor text, p_amount int, p_what text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_d uuid; v_c uuid;
  v_what text := left(public.olnu_gang_clean(p_what), 40);
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_d := public.olnu_gang_uid_of(p_group_id, p_debtor);
  v_c := public.olnu_gang_uid_of(p_group_id, p_creditor);
  if v_d is null or v_c is null or v_d = v_c or p_amount is null or p_amount < 1 or p_amount > 50000 or v_what = '' then
    raise exception 'invalid_debt';
  end if;
  perform public.olnu_gang_rl('debt:' || v_uid::text);
  if exists (select 1 from public.gang_debts d where d.created_by = v_uid and d.created_at > now() - interval '3 seconds')
     or (select count(*) from public.gang_debts d where d.created_by = v_uid and d.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'slow_down';
  end if;
  insert into public.gang_debts (group_id, created_by, debtor, creditor, amount, what)
  values (p_group_id, v_uid, v_d, v_c, p_amount, v_what) returning id into v_id;
  return jsonb_build_object('id', v_id);
end; $$;

-- settle_debt(id, 'paid'|'unpaid'|'cancel') -> {ok}
-- paid: debtor, creditor or the writer. unpaid (undo within 24 h): same people. cancel: the writer or the creditor.
create or replace function public.settle_debt(p_debt_id bigint, p_action text default 'paid')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_action, '')));
  d public.gang_debts;
begin
  if v_a not in ('paid', 'unpaid', 'cancel') then raise exception 'invalid_action'; end if;
  select * into d from public.gang_debts x where x.id = p_debt_id and x.cancelled_at is null;
  if not found or not public.olnu_gang_member(d.group_id, v_uid) then raise exception 'debt_not_found'; end if;
  if v_a = 'cancel' then
    if v_uid not in (d.created_by, d.creditor) then raise exception 'not_yours'; end if;
    update public.gang_debts x set cancelled_at = now(), cancelled_by = v_uid where x.id = d.id;
  elsif v_a = 'paid' then
    if v_uid not in (d.created_by, d.creditor, d.debtor) then raise exception 'not_yours'; end if;
    update public.gang_debts x set paid_at = coalesce(x.paid_at, now()), paid_by = coalesce(x.paid_by, v_uid) where x.id = d.id;
  else
    if v_uid not in (d.created_by, d.creditor, d.debtor) then raise exception 'not_yours'; end if;
    if d.paid_at is null or d.paid_at < now() - interval '1 day' then raise exception 'too_late'; end if;
    update public.gang_debts x set paid_at = null, paid_by = null where x.id = d.id;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- set_swish(group, number) -> {number}. Swedish mobile only: 07xxxxxxxx (spaces, dashes and +46/0046 accepted).
-- '' or null clears it. Visible to the members of THIS group only. 20 changes per group per user.
create or replace function public.set_swish(p_group_id uuid, p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v text := regexp_replace(coalesce(p_number, ''), '[\s\-().]', '', 'g');
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v like '+46%' then v := '0' || substr(v, 4); elsif v like '0046%' then v := '0' || substr(v, 5); end if;
  if v = '' then v := null;
  elsif v !~ '^07[0-9]{8}$' then raise exception 'invalid_swish';
  end if;
  if (select s.changes from public.gang_swish s where s.group_id = p_group_id and s.user_id = v_uid) >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.gang_swish (group_id, user_id, number, changes) values (p_group_id, v_uid, v, 1)
  on conflict (group_id, user_id) do update set number = excluded.number, changes = public.gang_swish.changes + 1, updated_at = now();
  return jsonb_build_object('number', v);
end; $$;

-- ---------------------------------------------------------------------------
-- 7. Morgontidningen: facts of the group's last night (no drink counts per person)
-- ---------------------------------------------------------------------------
-- gang_paper(group, p_night default null = the night that ended last) -> jsonb
-- {night, evening, group_name, town, out_n, members:[{k, name, is_me, out, bars, bar_names[], first_at, home_at,
--   skal, eta_max, rallies, mt_wins, quotes, kebab}], quotes:[{who, body}] (after 10:00), mt:[{q, names[]}],
--   takeovers:[bar names], crawl_done bool, ready bool}
create or replace function public.gang_paper(p_group_id uuid, p_night timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := coalesce(p_night, public.olnu_gang_last_night());
  v_mem jsonb; v_q jsonb; v_mt jsonb; v_take jsonb; v_town text; v_out int; v_crawl boolean := false;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_night > public.olnu_gang_last_night() then v_night := public.olnu_gang_last_night(); end if;
  with mem as (
    select m.user_id, m.display_name from public.group_members m where m.group_id = p_group_id
  ), mn as (
    select n.user_id, (n.beers + n.others) > 0 as out, n.first_at, n.home from public.medal_nights n
     where n.night = v_night and n.user_id in (select user_id from mem)
  ), an as (
    select a.user_id, a.out, a.town, a.home_at, a.skal_given from public.after_nights a
     where a.night = v_night and a.user_id in (select user_id from mem)
  ), bars as (
    select c.user_id, count(distinct c.bar_id)::int as n,
           (select jsonb_agg(distinct b.name) from public.medal_checkins c2 join public.bars_lite b on b.id = c2.bar_id
             where c2.user_id = c.user_id and c2.night = v_night and b.name is not null) as names
      from public.medal_checkins c
     where c.night = v_night and c.user_id in (select user_id from mem) group by c.user_id
  ), eta as (
    select e.user_id, max(e.minutes)::int as mx from public.etas e
     where e.user_id in (select user_id from mem) and public.olnu_night_of(e.created_at) = v_night and e.cancelled_at is null
     group by e.user_id
  ), ral as (
    select r.user_id, count(*)::int as n from public.rallies r
     where r.group_id = p_group_id and public.olnu_night_of(r.created_at) = v_night group by r.user_id
  ), rounds as (
    select r.* from public.gang_mt_rounds r where r.group_id = p_group_id and r.night = v_night
  ), mtw as (
    select w.target as user_id, count(*)::int as n from (
      select distinct on (v.round_id) v.round_id, v.target, count(*) over (partition by v.round_id, v.target) as c
        from public.gang_mt_votes v where v.round_id in (select id from rounds)
       order by v.round_id, c desc, v.target) w group by w.target
  ), kb as (
    select distinct on (k.user_id) k.user_id, k.place_name from public.kebab_ratings k
     where k.night = v_night and k.user_id in (select user_id from mem) order by k.user_id, k.stars desc, k.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_gang_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
           'out', coalesce(mn.out, false) or coalesce(an.out, false) or coalesce(b.n, 0) > 0,
           'bars', coalesce(b.n, 0), 'bar_names', coalesce(b.names, '[]'::jsonb),
           'first_at', mn.first_at,
           'home_at', coalesce(an.home_at, case when mn.home then v_night end),
           'skal', coalesce(an.skal_given, 0), 'eta_max', e.mx, 'rallies', coalesce(r.n, 0),
           'mt_wins', coalesce(w.n, 0),
           'quotes', (select count(*) from public.gang_quotes q where q.group_id = p_group_id and q.night = v_night
                       and not q.hidden and lower(q.who) = lower(m.display_name))::int,
           'kebab', kb.place_name) order by m.display_name), '[]'::jsonb),
         (select a.town from an a where a.town is not null group by a.town order by count(*) desc, a.town limit 1)
    into v_mem, v_town
    from mem m
    left join mn on mn.user_id = m.user_id left join an on an.user_id = m.user_id
    left join bars b on b.user_id = m.user_id left join eta e on e.user_id = m.user_id
    left join ral r on r.user_id = m.user_id left join mtw w on w.user_id = m.user_id
    left join kb on kb.user_id = m.user_id;

  select count(*)::int into v_out from jsonb_array_elements(v_mem) x where (x.value ->> 'out')::boolean;

  select coalesce(jsonb_agg(jsonb_build_object('who', q.who, 'body', q.body) order by q.id), '[]'::jsonb) into v_q
    from (select * from public.gang_quotes q where q.group_id = p_group_id and q.night = v_night and not q.hidden
            and q.reveal_at <= now() order by q.id limit 8) q;

  select coalesce(jsonb_agg(jsonb_build_object('q', r.q, 'names', (
           select coalesce(jsonb_agg(public.olnu_gang_name(p_group_id, x.target) order by x.target), '[]'::jsonb) from (
             select v.target, count(*) c, max(count(*)) over () mx from public.gang_mt_votes v
              where v.round_id = r.id group by v.target) x where x.c = x.mx)) order by r.id), '[]'::jsonb)
    into v_mt
    from public.gang_mt_rounds r where r.group_id = p_group_id and r.night = v_night
     and exists (select 1 from public.gang_mt_votes v where v.round_id = r.id);

  begin
    select coalesce(jsonb_agg(distinct t.bar_name), '[]'::jsonb) into v_take
      from public.bar_takeovers t where t.group_id = p_group_id and t.night = v_night and t.bar_name is not null;
  exception when others then v_take := '[]'::jsonb;
  end;
  begin
    select exists (select 1 from public.game_crawls c where c.group_id = p_group_id and c.night = v_night and c.done_at is not null)
      into v_crawl;
  exception when others then v_crawl := false;
  end;

  return jsonb_build_object('night', v_night, 'evening', public.olnu_evening(v_night),
    'group_name', (select g.name from public.groups g where g.id = p_group_id),
    'town', v_town, 'out_n', v_out, 'members', v_mem, 'quotes', v_q, 'mt', v_mt,
    'takeovers', coalesce(v_take, '[]'::jsonb), 'crawl_done', coalesce(v_crawl, false), 'ready', v_out > 0);
end; $$;

-- ---------------------------------------------------------------------------
-- Group state + light poll
-- ---------------------------------------------------------------------------
-- gang_group(group) -> {server_time, night, hour, members:[{k, name, is_me}], mt:{round, history[]},
--   poll (newest of tonight, open or ended < 60 min) | null, brunch (open) | null,
--   quotes:{pending (tonight, group, hidden until reveal), mine_pending, next_reveal, yesterday:[...]}, debts}
-- An open poll past its 15 min is finished here (winner -> call-out).
create or replace function public.gang_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_last timestamptz := public.olnu_gang_last_night();
  p public.gang_polls;
  r public.gang_mt_rounds;
  b public.gang_brunches;
  v_round jsonb := null; v_hist jsonb; v_poll jsonb := null; v_brunch jsonb := null;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  for p in select * from public.gang_polls x where x.group_id = p_group_id and x.ended_at is null and x.ends_at <= now() loop
    perform public.olnu_gang_rl('poll:' || p_group_id::text);
    perform public.olnu_gang_poll_finish(p.id, v_uid);
  end loop;
  select * into r from public.gang_mt_rounds x where x.group_id = p_group_id and x.night = v_night order by x.id desc limit 1;
  if found then v_round := public.olnu_gang_mt_json(r, v_uid); end if;
  select coalesce(jsonb_agg(public.olnu_gang_mt_json(x, v_uid) order by x.id desc), '[]'::jsonb) into v_hist
    from (select * from public.gang_mt_rounds y where y.group_id = p_group_id and y.night = v_night order by y.id desc limit 20) x;
  select * into p from public.gang_polls x
   where x.group_id = p_group_id and (x.ended_at is null or x.ended_at > now() - interval '60 minutes')
   order by x.id desc limit 1;
  if found then v_poll := public.olnu_gang_poll_json(p, v_uid); end if;
  select * into b from public.gang_brunches x where x.group_id = p_group_id and not x.closed and x.expires_at > now()
   order by x.id desc limit 1;
  if found then v_brunch := public.olnu_gang_brunch_json(b, v_uid); end if;
  return jsonb_build_object(
    'server_time', now(), 'night', v_night, 'last_night', v_last, 'hour', public.olnu_gang_hour(),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group_id, m.user_id),
                  'name', m.display_name, 'is_me', m.user_id = v_uid) order by m.user_id <> v_uid, m.display_name), '[]'::jsonb)
                  from public.group_members m where m.group_id = p_group_id),
    'mt', jsonb_build_object('round', v_round, 'history', v_hist),
    'poll', v_poll, 'brunch', v_brunch,
    'quotes', jsonb_build_object(
      'pending', (select count(*) from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.reveal_at > now())::int,
      'next_reveal', (select min(q.reveal_at) from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.reveal_at > now()),
      'yesterday', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'who', q.who, 'body', q.body, 'at', q.created_at) order by q.id), '[]'::jsonb)
                      from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.night = v_last and q.reveal_at <= now())),
    'debts', public.olnu_gang_debts_json(p_group_id, v_uid));
end; $$;

-- gang_poll() -> {v, server_time, night, last_night, hour, groups:[{id, name, mt_open, mt_voted, mt_last, poll_open, poll_id,
--   poll_voted, poll_winner (bar name, ended < 60 min), poll_due, brunch:{id, by, place, at_time, mine}|null, quotes_pending, quotes_yday, paper, debt_net}]} (max 20 groups)
create or replace function public.gang_poll()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_last timestamptz := public.olnu_gang_last_night();
  v_groups jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.joined), '[]'::jsonb) into v_groups from (
    select gm.joined_at as joined, jsonb_build_object(
      'id', g.id, 'name', g.name,
      'mt_open', exists (select 1 from public.gang_mt_rounds r where r.group_id = g.id and r.night = v_night and not public.olnu_gang_mt_done(r)),
      'mt_voted', exists (select 1 from public.gang_mt_rounds r join public.gang_mt_votes v on v.round_id = r.id and v.voter = v_uid
                           where r.group_id = g.id and r.night = v_night and not public.olnu_gang_mt_done(r)),
      'mt_last', (select r.id from public.gang_mt_rounds r where r.group_id = g.id and r.night = v_night order by r.id desc limit 1),
      'poll_open', exists (select 1 from public.gang_polls p where p.group_id = g.id and p.ended_at is null and p.ends_at > now()),
      'poll_id', (select p.id from public.gang_polls p where p.group_id = g.id and (p.ended_at is null or p.ended_at > now() - interval '60 minutes') order by p.id desc limit 1),
      'poll_voted', exists (select 1 from public.gang_polls p join public.gang_poll_votes v on v.poll_id = p.id and v.user_id = v_uid
                             where p.group_id = g.id and p.ended_at is null and p.ends_at > now()),
      'poll_winner', (select p.options -> p.winner ->> 'name' from public.gang_polls p
                       where p.group_id = g.id and p.ended_at > now() - interval '60 minutes' and p.winner is not null
                       order by p.id desc limit 1),
      'poll_due', exists (select 1 from public.gang_polls p where p.group_id = g.id and p.ended_at is null and p.ends_at <= now()),
      'brunch', (select jsonb_build_object('id', b.id, 'by', public.olnu_gang_name(g.id, b.user_id), 'by_me', b.user_id = v_uid,
                   'place', b.place, 'at_time', b.at_time,
                   'mine', (select a.answer from public.gang_brunch_answers a where a.brunch_id = b.id and a.user_id = v_uid),
                   'ja', (select count(*) from public.gang_brunch_answers a join public.group_members m2 on m2.group_id = g.id and m2.user_id = a.user_id
                           where a.brunch_id = b.id and a.answer = 'ja')::int)
                   from public.gang_brunches b where b.group_id = g.id and not b.closed and b.expires_at > now() order by b.id desc limit 1),
      'quotes_pending', (select count(*) from public.gang_quotes q where q.group_id = g.id and not q.hidden and q.reveal_at > now())::int,
      'quotes_yday', (select count(*) from public.gang_quotes q where q.group_id = g.id and not q.hidden and q.night = v_last and q.reveal_at <= now())::int,
      'paper', exists (select 1 from public.group_members m3
                        where m3.group_id = g.id and (
                          exists (select 1 from public.medal_nights n where n.user_id = m3.user_id and n.night = v_last and n.beers + n.others > 0)
                          or exists (select 1 from public.medal_checkins c where c.user_id = m3.user_id and c.night = v_last))),
      'debt_net', (select coalesce(sum(case when d.creditor = v_uid then d.amount else -d.amount end), 0)::int
                     from public.gang_debts d where d.group_id = g.id and d.paid_at is null and d.cancelled_at is null
                      and (d.creditor = v_uid or d.debtor = v_uid)
                      and d.debtor in (select m4.user_id from public.group_members m4 where m4.group_id = g.id)
                      and d.creditor in (select m4.user_id from public.group_members m4 where m4.group_id = g.id))
    ) as j
    from public.group_members gm join public.groups g on g.id = gm.group_id
   where gm.user_id = v_uid
   order by gm.joined_at limit 20) x;
  return jsonb_build_object('v', 1, 'server_time', now(), 'night', v_night, 'last_night', v_last,
                            'hour', public.olnu_gang_hour(), 'groups', v_groups);
end; $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  internal text[] := array[
    'public.olnu_gang_clean(text)', 'public.olnu_gang_k(uuid, uuid)', 'public.olnu_gang_member(uuid, uuid)',
    'public.olnu_gang_uid_of(uuid, text)', 'public.olnu_gang_name(uuid, uuid)', 'public.olnu_gang_last_night()',
    'public.olnu_gang_reveal(timestamptz)', 'public.olnu_gang_hour()', 'public.olnu_gang_town(float8, float8)',
    'public.olnu_gang_rl(text)', 'public.olnu_gang_mt_done(public.gang_mt_rounds)',
    'public.olnu_gang_mt_json(public.gang_mt_rounds, uuid)', 'public.olnu_gang_poll_json(public.gang_polls, uuid)',
    'public.olnu_gang_poll_winner(public.gang_polls)', 'public.olnu_gang_poll_finish(bigint, uuid)',
    'public.olnu_gang_brunch_json(public.gang_brunches, uuid)', 'public.olnu_gang_debts_json(uuid, uuid)'];
  rpcs text[] := array[
    'public.add_quote(uuid, text, text, bigint)', 'public.hide_quote(bigint)', 'public.gang_quotes(uuid, bigint)',
    'public.mt_start(uuid, int)', 'public.mt_vote(bigint, text)', 'public.mt_close(bigint)',
    'public.create_bar_poll(uuid, jsonb)', 'public.vote_bar_poll(bigint, int)', 'public.end_bar_poll(bigint)',
    'public.create_brunch(uuid, text, text, float8, float8, text)', 'public.answer_brunch(bigint, text)', 'public.close_brunch(bigint)',
    'public.rate_kebab(text, text, float8, float8, int, text, float8, float8)', 'public.kebab_top(float8, float8, int)',
    'public.kebab_place(text)',
    'public.add_debt(uuid, text, text, int, text)', 'public.settle_debt(bigint, text)', 'public.set_swish(uuid, text)',
    'public.gang_paper(uuid, timestamptz)', 'public.gang_group(uuid)', 'public.gang_poll()'];
begin
  foreach f in array internal || rpcs loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach f in array rpcs loop
      execute format('grant execute on function %s to authenticated', f);
    end loop;
  end if;
end $$;

-- ===== supabase/migrations/0029_keep_history.sql =====
-- 0029 Groups can keep their chat (+ voice, + photos when 0028 exists) after 05:00, forever.
-- A group setting keep_history (default off = everything ends at 05:00 as before).
-- Any member can see it; any member can change it (groups have no admins besides created_by;
-- the creator or, if the creator left, any member may toggle). Changing it also extends or
-- shortens the group's current live messages.
create table if not exists public.group_settings (
  group_id     uuid primary key,
  keep_history boolean not null default false,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
alter table public.group_settings enable row level security;
revoke all on public.group_settings from anon, authenticated;

create or replace function public.olnu_group_keeps(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.keep_history from public.group_settings s where s.group_id = p_group_id), false);
$$;
revoke all on function public.olnu_group_keeps(uuid) from public, anon, authenticated;

-- New rows in a keeping group never expire.
create or replace function public.olnu_keep_history_ins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.olnu_group_keeps(new.group_id) then new.expires_at := 'infinity'::timestamptz; end if;
  return new;
end; $$;
revoke all on function public.olnu_keep_history_ins() from public, anon, authenticated;
create or replace trigger group_msgs_keep before insert on public.group_msgs
  for each row execute function public.olnu_keep_history_ins();
create or replace trigger voice_msgs_keep before insert on public.voice_msgs
  for each row execute function public.olnu_keep_history_ins();

create or replace function public.group_keep_history(p_group_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_group_keeps(p_group_id);
end; $$;

create or replace function public.set_group_keep_history(p_group_id uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_creator uuid; v_on boolean := coalesce(p_on, false);
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select g.created_by into v_creator from public.groups g where g.id = p_group_id;
  if v_creator is not null and v_creator <> v_uid
     and exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_creator) then
    raise exception 'not_admin';
  end if;
  insert into public.group_settings as s (group_id, keep_history, changed_by, changed_at)
  values (p_group_id, v_on, v_uid, now())
  on conflict (group_id) do update set keep_history = v_on, changed_by = v_uid, changed_at = now();
  if v_on then
    update public.group_msgs set expires_at = 'infinity' where group_id = p_group_id and expires_at > now();
    update public.voice_msgs set expires_at = 'infinity' where group_id = p_group_id and expires_at > now();
  else
    update public.group_msgs set expires_at = public.olnu_next_expiry() where group_id = p_group_id and expires_at = 'infinity';
    update public.voice_msgs set expires_at = public.olnu_next_expiry() where group_id = p_group_id and expires_at = 'infinity';
  end if;
  return v_on;
end; $$;

revoke all on function public.group_keep_history(uuid) from public, anon;
revoke all on function public.set_group_keep_history(uuid, boolean) from public, anon;
grant execute on function public.group_keep_history(uuid) to authenticated;
grant execute on function public.set_group_keep_history(uuid, boolean) to authenticated;

-- ===== supabase/migrations/0028_chat_photos.sql =====
-- 0028 v21 BILDER (photos in the group chat). Client: docs/js/photo.js + docs/photo.css.
-- The phone makes a small JPEG (max 1024 px, about 120 KB, no EXIF). The server keeps the bytes in
-- chat_photos and adds a normal chat row (body "📷" or "📷 <caption>") so the photo sits in order in the
-- chat. Old apps see only that text. The link msg -> photo is chat_photos.msg_id.
-- Space on the free plan: post_photo first sets bytes = null on expired photos (an UPDATE, rows stay),
-- so autovacuum can reuse the space. Max 60 photos per group per night, 10 per user per night.
-- Keep history (0029, optional): a keeping group's photos get expires_at = infinity (insert trigger) and
-- follow the group setting when it is switched on or off (trigger on group_settings). Works without 0029.
-- Additive only. Needs 0001-0021 (group_members, group_msgs, olnu_uid, olnu_next_expiry).
-- Rows are never removed; every read filters on time. RLS on, no policies.
-- All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only. Safe to run again.

create table if not exists public.chat_photos (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  msg_id     bigint null,
  mime       text not null,
  bytes      bytea null,
  size       int not null default 0,
  w          int not null default 0,
  h          int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists chat_photos_group_idx on public.chat_photos (group_id, id);
create index if not exists chat_photos_user_idx  on public.chat_photos (user_id, created_at);
create index if not exists chat_photos_msg_idx   on public.chat_photos (msg_id);
create index if not exists chat_photos_live_idx  on public.chat_photos (expires_at) where bytes is not null;
alter table public.chat_photos enable row level security;
revoke all on table public.chat_photos from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.chat_photos from anon';
    execute 'revoke all on sequence public.chat_photos_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.chat_photos from authenticated';
    execute 'revoke all on sequence public.chat_photos_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.chat_photos to service_role';
  end if;
end $$;

-- "Radera allt om mig" (the erase RPC of 0016) moves every uuid column of the caller to a new random id.
-- When user_id of a photo changes, the picture itself is emptied and the photo ends now.
create or replace function public.olnu_photo_anon_tg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  begin
    if new.user_id is distinct from old.user_id then
      new.bytes := null;
      new.size := 0;
      new.expires_at := least(new.expires_at, now());
    end if;
  exception when others then null;
  end;
  return new;
end;
$$;
revoke all on function public.olnu_photo_anon_tg() from public;
create or replace trigger chat_photos_anon before update of user_id on public.chat_photos
  for each row execute function public.olnu_photo_anon_tg();

-- post_photo(p_group_id, p_b64, p_w, p_h, p_caption default null) -> jsonb {id, msg_id, created_at, expires_at, left, mime}
-- Errors: not_member, invalid_photo (bad base64, not JPEG/WebP, < 200 B or > 160 KB, bad size),
--         invalid_msg (caption > 138 chars), slow_down (15 s), photo_limit (10 per user per night),
--         group_photo_limit (60 per group per night).
create or replace function public.post_photo(p_group_id uuid, p_b64 text, p_w int default 0, p_h int default 0, p_caption text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_cap  text := btrim(regexp_replace(coalesce(p_caption, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_exp  timestamptz := public.olnu_next_expiry();
  -- Start of tonight (05:00 yesterday, DST-correct). Limits count by created_at, because a keeping group
  -- (0029 keep_history) stores expires_at = infinity.
  v_from timestamptz := ((v_exp at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
  v_data bytea;
  v_mime text;
  v_n    int;
  v_g    int;
  v_body text;
  v_mid  bigint;
  v_row  public.chat_photos;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if char_length(v_cap) > 138 then
    raise exception 'invalid_msg';
  end if;
  if p_b64 is null or length(p_b64) > 220000 then
    raise exception 'invalid_photo';
  end if;
  begin
    v_data := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_photo';
  end;
  if v_data is null or octet_length(v_data) < 200 or octet_length(v_data) > 163840 then
    raise exception 'invalid_photo';
  end if;
  -- Magic bytes: JPEG FF D8 FF, WebP "RIFF" .... "WEBP".
  if substring(v_data from 1 for 3) = '\xffd8ff'::bytea then
    v_mime := 'image/jpeg';
  elsif substring(v_data from 1 for 4) = '\x52494646'::bytea and substring(v_data from 9 for 4) = '\x57454250'::bytea then
    v_mime := 'image/webp';
  else
    raise exception 'invalid_photo';
  end if;
  if coalesce(p_w, 0) < 1 or coalesce(p_h, 0) < 1 or p_w > 2048 or p_h > 2048 then
    raise exception 'invalid_photo';
  end if;

  -- Keep the database small: empty the bytes of expired photos (rows stay, space is reused).
  -- expires_at < now() only: rows of keeping groups (infinity) never match.
  update public.chat_photos cp set bytes = null where cp.expires_at < now() and cp.bytes is not null;

  perform pg_advisory_xact_lock(hashtextextended('olnu_photo:' || v_uid::text, 0));
  if exists (select 1 from public.chat_photos cp where cp.user_id = v_uid and cp.created_at > now() - interval '15 seconds') then
    raise exception 'slow_down';
  end if;
  select count(*) into v_n from public.chat_photos cp where cp.user_id = v_uid and cp.created_at >= v_from;
  if v_n >= 10 then
    raise exception 'photo_limit';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_photo_g:' || p_group_id::text, 0));
  select count(*) into v_g from public.chat_photos cp where cp.group_id = p_group_id and cp.created_at >= v_from;
  if v_g >= 60 then
    raise exception 'group_photo_limit';
  end if;

  v_body := case when v_cap = '' then '📷' else '📷 ' || v_cap end;
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, v_exp)
  returning id into v_mid;
  insert into public.chat_photos (group_id, user_id, msg_id, mime, bytes, size, w, h, expires_at)
  values (p_group_id, v_uid, v_mid, v_mime, v_data, octet_length(v_data), p_w, p_h, v_exp)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'msg_id', v_mid, 'created_at', v_row.created_at,
    'expires_at', v_row.expires_at, 'left', 9 - v_n, 'mime', v_mime);
end;
$$;

-- group_photos(p_group_id, p_after_id default 0, p_before_id default null) -> live photos (no bytes), oldest first,
-- the newest 100 with id > p_after_id; with p_before_id: the newest 100 with id < p_before_id (older chat pages).
-- created_at equals the created_at of the linked chat row (same transaction, same now()).
create or replace function public.group_photos(p_group_id uuid, p_after_id bigint default 0, p_before_id bigint default null)
returns table (id bigint, msg_id bigint, w int, h int, size int, created_at timestamptz, is_me boolean)
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
  select x.id, x.msg_id, x.w, x.h, x.size, x.created_at, x.is_me from (
    select cp.id, cp.msg_id, cp.w, cp.h, cp.size, cp.created_at, cp.user_id = v_uid as is_me
      from public.chat_photos cp
     where cp.group_id = p_group_id and cp.expires_at > now() and cp.bytes is not null
       and cp.id > coalesce(p_after_id, 0) and (p_before_id is null or cp.id < p_before_id)
     order by cp.id desc limit 100) x
   order by x.id;
end;
$$;

-- group_photo(p_photo_id) -> jsonb {id, mime, w, h, b64}. Errors: photo_not_found (expired/unknown), not_member.
create or replace function public.group_photo(p_photo_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.chat_photos;
begin
  select * into v_row from public.chat_photos cp where cp.id = p_photo_id and cp.expires_at > now() and cp.bytes is not null;
  if not found then
    raise exception 'photo_not_found';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end;
$$;

revoke all on function public.post_photo(uuid, text, integer, integer, text) from public;
revoke all on function public.group_photos(uuid, bigint, bigint) from public;
revoke all on function public.group_photo(bigint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_photo_anon_tg(), public.post_photo(uuid, text, integer, integer, text), '
         || 'public.group_photos(uuid, bigint, bigint), public.group_photo(bigint) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_photo_anon_tg() from authenticated';
    execute 'grant execute on function public.post_photo(uuid, text, integer, integer, text), '
         || 'public.group_photos(uuid, bigint, bigint), public.group_photo(bigint) to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Keep history (0029). Only when 0029 is there; safe in any order (run 0028 again after 0029).
-- ---------------------------------------------------------------------------
create or replace function public.olnu_photo_keep_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.keep_history then
      update public.chat_photos cp set expires_at = 'infinity'::timestamptz
       where cp.group_id = new.group_id and cp.expires_at > now() and cp.bytes is not null;
    elsif tg_op = 'UPDATE' then
      update public.chat_photos cp set expires_at = public.olnu_next_expiry()
       where cp.group_id = new.group_id and cp.expires_at = 'infinity'::timestamptz;
    end if;
  exception when others then null;
  end;
  return null;
end;
$$;
revoke all on function public.olnu_photo_keep_tg() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_photo_keep_tg() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_photo_keep_tg() from authenticated';
  end if;
  if to_regprocedure('public.olnu_keep_history_ins()') is not null then
    execute 'create or replace trigger chat_photos_keep before insert on public.chat_photos '
         || 'for each row execute function public.olnu_keep_history_ins()';
  end if;
  if to_regclass('public.group_settings') is not null then
    execute 'create or replace trigger group_settings_photos after insert or update of keep_history on public.group_settings '
         || 'for each row execute function public.olnu_photo_keep_tg()';
  end if;
end $$;

-- ===========================================================================
-- 0027_crew.sql (v20 TRUPPEN)
-- ===========================================================================
-- 0027 v20 TRUPPEN (crew pack). Client: docs/js/crew.js + docs/js/crew-content.js + docs/crew.css.
-- 1 Avgångstavlan (group departure board: "Vi drar 22:30 till Pitchers", Med!)
-- 2 Vilken kväll? (date poll: Kan / Kanske / Kan inte, winner)
-- 3 Ingen lämnas kvar ("Hej då" button; who left, who is still out; alone card)
-- 4 Dansgolvsmätaren (dance floor report on a bar: 0 Tomt / 1 Lite rörelse / 2 Fullt ös; 300 m; lives 30 min)
-- 5 Skålstafetten (one virtual torch per town per night, passed between groups, accept within 10 min)
-- 6 Kvällsrepris (next day 05-18: replay of the group's night from bar points / ~550 m grid points only)
-- 7 Hur mår truppen? (one-tap group check: bra / snurr / hem)
-- Additive only. Needs 0001-0025 (groups, checkins, beers.snap_*, bars_lite, olnu_towns, olnu_town_of,
-- after_nights, group_flags, olnu_dist_m, olnu_world_ok, olnu_night_of, olnu_evening).
-- Rows are never removed; every read filters on time. RLS on, no policies.
-- All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only.
-- No pushes in this version (in-app only). Safe to run again.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.crew_deps (
  id           bigserial primary key,
  group_id     uuid not null,
  user_id      uuid not null,
  night        timestamptz not null,
  leave_at     timestamptz not null,
  bar_id       text null,
  bar_name     text null,
  lat          float8 null,
  lng          float8 null,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz null,
  notified     boolean not null default false
);
create index if not exists crew_deps_group_idx on public.crew_deps (group_id, night);
create index if not exists crew_deps_user_idx on public.crew_deps (user_id, created_at desc);

create table if not exists public.crew_dep_going (
  dep_id      bigint not null,
  user_id     uuid not null,
  going       boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (dep_id, user_id)
);

create table if not exists public.crew_date_polls (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,
  title       text null,
  dates       date[] not null,
  created_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  closed_at   timestamptz null
);
create index if not exists crew_date_polls_group_idx on public.crew_date_polls (group_id, id desc);
create index if not exists crew_date_polls_user_idx on public.crew_date_polls (user_id, created_at desc);

create table if not exists public.crew_date_votes (
  poll_id     bigint not null,
  user_id     uuid not null,
  d           date not null,
  answer      text not null check (answer in ('kan', 'kanske', 'nej')),
  updated_at  timestamptz not null default now(),
  primary key (poll_id, user_id, d)
);

create table if not exists public.crew_byes (
  user_id     uuid not null,
  night       timestamptz not null,
  at          timestamptz not null default now(),
  cleared_at  timestamptz null,
  primary key (user_id, night)
);

create table if not exists public.crew_dance (
  id          bigserial primary key,
  bar_id      text not null,
  user_id     uuid not null,
  level       smallint not null check (level between 0 and 2),
  bar_lat     float8 not null,
  bar_lng     float8 not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists crew_dance_bar_idx on public.crew_dance (bar_id, expires_at);
create index if not exists crew_dance_user_idx on public.crew_dance (user_id, bar_id, created_at desc);

create table if not exists public.crew_torches (
  id             bigserial primary key,
  town           text not null,                 -- 't:<town>' or 'z:<lat>:<lng>' (~50 km zone)
  town_name      text null,
  c_lat          float8 not null,
  c_lng          float8 not null,
  night          timestamptz not null,
  holder         uuid null,                     -- group id
  pending        uuid null,                     -- group id that must accept
  pending_from   uuid null,
  pending_at     timestamptz null,
  pending_until  timestamptz null,
  passes         int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (town, night)
);
create index if not exists crew_torches_night_idx on public.crew_torches (night);

create table if not exists public.crew_torch_hops (
  id          bigserial primary key,
  torch_id    bigint not null,
  from_group  uuid null,
  to_group    uuid not null,
  how         text not null check (how in ('light', 'pass', 'random')),
  by_user     uuid null,
  bar_id      text null,
  bar_name    text null,
  lat         float8 null,                      -- bar point only (never a pin / home)
  lng         float8 null,
  created_at  timestamptz not null default now()
);
create index if not exists crew_torch_hops_torch_idx on public.crew_torch_hops (torch_id, id);
create index if not exists crew_torch_hops_to_idx on public.crew_torch_hops (to_group, created_at desc);

-- Per-user night track for Kvällsrepris: bar points (check-ins, pins snapped to a bar) or the
-- ~550 m grid point of a pin. Never an exact pin, never a ghost pin. Read for 24 h only.
create table if not exists public.crew_tracks (
  id          bigserial primary key,
  user_id     uuid not null,
  night       timestamptz not null,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('ci', 'drink')),
  bar_id      text null,
  bar_name    text null,
  lat         float8 not null,
  lng         float8 not null
);
create index if not exists crew_tracks_user_idx on public.crew_tracks (user_id, night, at);

create table if not exists public.crew_moods (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,
  night       timestamptz not null,
  created_at  timestamptz not null default now(),
  ends_at     timestamptz not null
);
create index if not exists crew_moods_group_idx on public.crew_moods (group_id, id desc);
create index if not exists crew_moods_user_idx on public.crew_moods (user_id, created_at desc);

create table if not exists public.crew_mood_answers (
  mood_id     bigint not null,
  user_id     uuid not null,
  answer      text not null check (answer in ('bra', 'snurr', 'hem')),
  updated_at  timestamptz not null default now(),
  primary key (mood_id, user_id)
);

alter table public.crew_deps         enable row level security;
alter table public.crew_dep_going    enable row level security;
alter table public.crew_date_polls   enable row level security;
alter table public.crew_date_votes   enable row level security;
alter table public.crew_byes         enable row level security;
alter table public.crew_dance        enable row level security;
alter table public.crew_torches      enable row level security;
alter table public.crew_torch_hops   enable row level security;
alter table public.crew_tracks       enable row level security;
alter table public.crew_moods        enable row level security;
alter table public.crew_mood_answers enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_crew_clean(p text, n int)
returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), n), '');
$$;

-- Opaque member key (never a user id).
create or replace function public.olnu_crew_k(p_group uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select left(md5('crew:' || p_group::text || ':' || p_uid::text), 12);
$$;

create or replace function public.olnu_crew_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$$;

create or replace function public.olnu_crew_name(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid;
$$;

-- "Now" for the replay window only (local tests can set olnu.crew_now; clients cannot set it).
create or replace function public.olnu_crew_now()
returns timestamptz language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('olnu.crew_now', true), '')::timestamptz, now());
$$;

-- The night that ended most recently (the 05:00 before the current night key). DST-safe (26 h back).
create or replace function public.olnu_crew_last_night(p_now timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select public.olnu_night_of(public.olnu_night_of(p_now) - interval '26 hours');
$$;

-- Torch town of a point: nearest olnu_towns town (~30 km), else a ~50 km zone.
create or replace function public.olnu_crew_town(p_lat float8, p_lng float8)
returns table (key text, name text, lat float8, lng float8)
language plpgsql stable security definer set search_path = public as $$
declare
  v_name text;
begin
  if p_lat is null or p_lng is null then return; end if;
  v_name := public.olnu_town_of(p_lat, p_lng);
  if v_name is not null then
    return query select 't:' || t.name, t.name, t.lat, t.lng from public.olnu_towns t where t.name = v_name limit 1;
    return;
  end if;
  return query select 'z:' || (round(p_lat::numeric * 2) / 2)::numeric(6, 1)::text || ':' || round(p_lng::numeric)::int::text,
                      null::text, ((round(p_lat::numeric * 2) / 2))::float8, (round(p_lng::numeric))::float8;
end; $$;

-- Where a user is right now: the newest of a live check-in (< 3 h) and a live visible pin.
-- bar_lat/bar_lng = the bar point (check-in point, or the snap point of a pin snapped to a bar).
create or replace function public.olnu_crew_pres(p_uid uuid)
returns table (lat float8, lng float8, bar_id text, bar_name text, bar_lat float8, bar_lng float8, at timestamptz)
language sql stable security definer set search_path = public as $$
  select x.lat, x.lng, x.bar_id, x.bar_name, x.bar_lat, x.bar_lng, x.at from (
    select c.lat, c.lng, c.bar_id, c.bar_name, coalesce(bl.lat, c.lat) as bar_lat, coalesce(bl.lng, c.lng) as bar_lng,
           c.created_at as at
      from public.checkins c left join public.bars_lite bl on bl.id = c.bar_id
     where c.user_id = p_uid and c.expires_at > now() and c.created_at > now() - interval '3 hours'
    union all
    select b.lat, b.lng, b.snap_bar, bl.name,
           case when b.snap_bar is not null then coalesce(bl.lat, b.snap_lat) end,
           case when b.snap_bar is not null then coalesce(bl.lng, b.snap_lng) end,
           greatest(b.beer_at, b.other_at, b.created_at)
      from public.beers b left join public.bars_lite bl on bl.id = b.snap_bar
     where b.user_id = p_uid and b.expires_at > now() and not b.stopped and not b.ghost
       and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)) >= 1
  ) x order by x.at desc limit 1;
$$;

-- Members of a group tonight with state: out | left (Hej då) | home (Jag är hemma) | quiet (was out, no
-- live pin/check-in) | none. A newer pin/check-in after Hej då/home counts as out again.
create or replace function public.olnu_crew_members(p_group uuid, p_viewer uuid)
returns table (uid uuid, k text, name text, is_me boolean, state text, left_at timestamptz,
               lat float8, lng float8, bar_id text, bar_name text, pres_at timestamptz, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with m as (
    select gm.user_id, gm.display_name, gm.joined_at from public.group_members gm where gm.group_id = p_group
  ), x as (
    select m.user_id, m.display_name, m.joined_at, p.lat, p.lng, p.bar_id, p.bar_name, p.at,
           (select y.at from public.crew_byes y where y.user_id = m.user_id and y.night = v_night and y.cleared_at is null) as bye_at,
           (select an.home_at from public.after_nights an where an.user_id = m.user_id and an.night = v_night) as home_at,
           coalesce((select an.out from public.after_nights an where an.user_id = m.user_id and an.night = v_night), false) as was_out
      from m left join lateral public.olnu_crew_pres(m.user_id) p on true
  )
  select x.user_id, public.olnu_crew_k(p_group, x.user_id), x.display_name, x.user_id = p_viewer,
         case
           when x.at is not null and (x.bye_at is null or x.at > x.bye_at) and (x.home_at is null or x.at > x.home_at) then 'out'
           when x.bye_at is not null and (x.home_at is null or x.bye_at >= x.home_at) then 'left'
           when x.home_at is not null then 'home'
           when x.was_out then 'quiet'
           else 'none'
         end,
         greatest(x.bye_at, x.home_at),
         x.lat, x.lng, x.bar_id, x.bar_name, x.at, x.joined_at
    from x;
end; $$;

-- Groups with members out in a torch town right now (members who said Hej då are not counted).
-- bar = the bar where most of the group's present members are (bar points only).
create or replace function public.olnu_crew_town_groups(p_key text, p_lat float8, p_lng float8)
returns table (group_id uuid, n int, bar_id text, bar_name text, bar_lat float8, bar_lng float8)
language plpgsql stable security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with raw as (
    select c.user_id as u, c.lat, c.lng, c.bar_id as bid, c.bar_name as bname,
           coalesce(bl.lat, c.lat) as blat, coalesce(bl.lng, c.lng) as blng, c.created_at as at
      from public.checkins c left join public.bars_lite bl on bl.id = c.bar_id
     where c.expires_at > now() and c.created_at > now() - interval '3 hours'
       and abs(c.lat - p_lat) < 0.6 and abs(c.lng - p_lng) < 1.2
    union all
    select b.user_id, b.lat, b.lng, b.snap_bar, bl.name,
           case when b.snap_bar is not null then coalesce(bl.lat, b.snap_lat) end,
           case when b.snap_bar is not null then coalesce(bl.lng, b.snap_lng) end,
           greatest(b.beer_at, b.other_at, b.created_at)
      from public.beers b left join public.bars_lite bl on bl.id = b.snap_bar
     where b.expires_at > now() and not b.stopped and not b.ghost
       and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)) >= 1
       and abs(b.lat - p_lat) < 0.6 and abs(b.lng - p_lng) < 1.2
  ), pres as (
    select distinct on (r.u) r.* from raw r order by r.u, r.at desc
  ), ok as (
    select p.* from pres p
     where (select t.key from public.olnu_crew_town(p.lat, p.lng) t) = p_key
       and not exists (select 1 from public.crew_byes y where y.user_id = p.u and y.night = v_night
                         and y.cleared_at is null and y.at >= p.at)
       and not exists (select 1 from public.after_nights an where an.user_id = p.u and an.night = v_night
                         and an.home_at is not null and an.home_at >= p.at)
  ), gm as (
    select m.group_id as g, ok.* from ok join public.group_members m on m.user_id = ok.u
  ), cnt as (
    select gm.g, count(distinct gm.u)::int as n from gm group by gm.g
  ), bars as (
    select gm.g, gm.bid, max(gm.bname) as bname, max(gm.blat) as blat, max(gm.blng) as blng,
           count(distinct gm.u) as c, max(gm.at) as mat
      from gm where gm.bid is not null and gm.blat is not null group by gm.g, gm.bid
  ), best as (
    select distinct on (b.g) b.* from bars b order by b.g, b.c desc, b.mat desc
  )
  select cnt.g, cnt.n, best.bid, best.bname, best.blat, best.blng
    from cnt left join best on best.g = cnt.g;
end; $$;

-- Group label for a viewer: name when the viewer is a member or the group opted in to be shown on
-- the map (0014 group_flags.show_on_map), else null (client: "en grupp vid <bar>" / "en grupp i stan").
create or replace function public.olnu_crew_glabel(p_group uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_group is null then null else jsonb_build_object(
    'name', case when public.olnu_crew_member(p_group, p_viewer)
                   or coalesce((select f.show_on_map from public.group_flags f where f.group_id = p_group), false)
                 then (select g.name from public.groups g where g.id = p_group) end,
    'mine', public.olnu_crew_member(p_group, p_viewer)) end;
$$;

-- Torch timeout: a pending pass not accepted in time (or declined) moves on to a random other group in
-- town (not the giver, not the one that let it go). Nobody else in town -> it stays with the holder.
create or replace function public.olnu_crew_torch_move(p_torch bigint, p_skip uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.crew_torches;
  c record;
begin
  select * into t from public.crew_torches x where x.id = p_torch for update;
  if not found or t.pending is null then return; end if;
  select * into c from public.olnu_crew_town_groups(t.town, t.c_lat, t.c_lng) g
   where g.group_id is distinct from t.holder and g.group_id is distinct from p_skip
     and g.group_id is distinct from t.pending
   order by random() limit 1;
  if c.group_id is null then
    update public.crew_torches x set pending = null, pending_from = null, pending_at = null, pending_until = null,
           updated_at = now() where x.id = t.id;
    return;
  end if;
  insert into public.crew_torch_hops (torch_id, from_group, to_group, how, bar_id, bar_name, lat, lng)
  values (t.id, t.holder, c.group_id, 'random', c.bar_id, c.bar_name, c.bar_lat, c.bar_lng);
  update public.crew_torches x set holder = c.group_id, pending = null, pending_from = null, pending_at = null,
         pending_until = null, passes = x.passes + 1, updated_at = now() where x.id = t.id;
end; $$;

create or replace function public.olnu_crew_torch_tick(p_torch bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.crew_torches;
begin
  select * into t from public.crew_torches x where x.id = p_torch;
  if found and t.pending is not null and t.pending_until <= now() then
    perform pg_advisory_xact_lock(hashtextextended('olnu_crew_torch:' || t.id::text, 0));
    select * into t from public.crew_torches x where x.id = p_torch;
    if t.pending is not null and t.pending_until <= now() then
      perform public.olnu_crew_torch_move(t.id, t.pending);
    end if;
  end if;
end; $$;

-- Caller's torch town: own presence first, else the given point.
create or replace function public.olnu_crew_my_town(p_uid uuid, p_lat float8, p_lng float8)
returns table (key text, name text, lat float8, lng float8)
language plpgsql stable security definer set search_path = public as $$
declare
  p record;
begin
  select * into p from public.olnu_crew_pres(p_uid);
  if p.lat is not null then
    return query select * from public.olnu_crew_town(p.lat, p.lng);
    return;
  end if;
  if public.olnu_world_ok(p_lat, p_lng) then
    return query select * from public.olnu_crew_town(p_lat, p_lng);
  end if;
end; $$;

-- Full torch state for a viewer.
create or replace function public.olnu_crew_torch_json(p_torch bigint, p_uid uuid, p_cands boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.crew_torches;
  v_hops jsonb; v_cands jsonb := '[]'::jsonb; v_mine boolean;
  v_hb record;
begin
  select * into t from public.crew_torches x where x.id = p_torch;
  if not found then return null; end if;
  v_mine := t.holder is not null and public.olnu_crew_member(t.holder, p_uid);
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', h.created_at, 'how', h.how, 'bar_name', h.bar_name, 'lat', h.lat, 'lng', h.lng,
           'to', public.olnu_crew_glabel(h.to_group, p_uid),
           'by', case when h.by_user is not null and public.olnu_crew_member(h.to_group, p_uid)
                      then public.olnu_crew_name(h.to_group, h.by_user) end) order by h.id), '[]'::jsonb)
    into v_hops from public.crew_torch_hops h where h.torch_id = t.id;
  select h.bar_name into v_hb from public.crew_torch_hops h where h.torch_id = t.id and h.to_group = t.holder
   order by h.id desc limit 1;
  if p_cands and v_mine and t.pending is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', left(md5('crewt:' || t.id::text || ':' || g.group_id::text), 12),
             'label', public.olnu_crew_glabel(g.group_id, p_uid), 'bar_name', g.bar_name, 'n', g.n)
             order by g.n desc, g.bar_name), '[]'::jsonb)
      into v_cands from public.olnu_crew_town_groups(t.town, t.c_lat, t.c_lng) g
     where g.group_id is distinct from t.holder;
  end if;
  return jsonb_build_object(
    'id', t.id, 'town', t.town_name, 'night', t.night, 'passes', t.passes,
    'holder', public.olnu_crew_glabel(t.holder, p_uid), 'holder_bar', v_hb.bar_name,
    'holder_group', case when v_mine then t.holder end,
    'pending', case when t.pending is null then null else jsonb_build_object(
        'to', public.olnu_crew_glabel(t.pending, p_uid),
        'to_group', case when public.olnu_crew_member(t.pending, p_uid) then t.pending end,
        'from', public.olnu_crew_glabel(t.pending_from, p_uid),
        'at', t.pending_at, 'until', t.pending_until) end,
    'hops', v_hops, 'cands', v_cands);
end; $$;

-- ---------------------------------------------------------------------------
-- Track triggers (Kvällsrepris). They never block a check-in or a drink.
-- ---------------------------------------------------------------------------
create or replace function public.olnu_crew_track_add(p_uid uuid, p_kind text, p_bar text, p_name text, p_lat float8, p_lng float8)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(now());
  v_last record;
begin
  if p_lat is null or p_lng is null then return; end if;
  if (select count(*) from public.crew_tracks x where x.user_id = p_uid and x.night = v_night) >= 300 then return; end if;
  select x.lat, x.lng, x.at, x.kind into v_last from public.crew_tracks x
   where x.user_id = p_uid and x.night = v_night order by x.at desc limit 1;
  -- same point and same kind within 5 min -> one point
  if v_last.lat is not null and v_last.lat = p_lat and v_last.lng = p_lng and v_last.kind = p_kind
     and v_last.at > now() - interval '5 minutes' then return; end if;
  insert into public.crew_tracks (user_id, night, kind, bar_id, bar_name, lat, lng)
  values (p_uid, v_night, p_kind, p_bar, left(p_name, 60), round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8);
end; $$;

create or replace function public.olnu_crew_ci_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lat float8; v_lng float8;
begin
  begin
    if tg_op = 'INSERT' or new.created_at is distinct from old.created_at or new.bar_id is distinct from old.bar_id then
      select bl.lat, bl.lng into v_lat, v_lng from public.bars_lite bl where bl.id = new.bar_id;
      perform public.olnu_crew_track_add(new.user_id, 'ci', new.bar_id, new.bar_name,
                                         coalesce(v_lat, new.lat), coalesce(v_lng, new.lng));
    end if;
  exception when others then
    null;   -- a replay bug never blocks a check-in
  end;
  return new;
end; $$;
create or replace trigger olnu_crew_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_crew_ci_tg();

-- Deferred to the end of the transaction: post_beer_v2 with Spökläge first writes a visible row and
-- hides it later in the same call, so the trigger re-reads the final row before it writes a track.
create or replace function public.olnu_crew_beer_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b public.beers;
  v_name text;
begin
  begin
    if tg_op = 'INSERT'
       or coalesce(new.beer_count, 0) > coalesce(old.beer_count, 0)
       or coalesce(new.other_count, 0) > coalesce(old.other_count, 0) then
      select * into b from public.beers x where x.id = new.id;
      if found and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
         and b.snap_lat is not null and b.snap_lng is not null
         and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)) >= 1 then
        if b.snap_bar is not null then
          select bl.name into v_name from public.bars_lite bl where bl.id = b.snap_bar;
        end if;
        -- snap point = the bar point (pin at a bar) or the ~550 m grid point; never the exact pin
        perform public.olnu_crew_track_add(b.user_id, 'drink', b.snap_bar, v_name, b.snap_lat, b.snap_lng);
      end if;
    end if;
  exception when others then
    null;   -- a replay bug never blocks a drink
  end;
  return null;
end; $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'olnu_crew_beers_end' and tgrelid = 'public.beers'::regclass) then
    create constraint trigger olnu_crew_beers_end
      after insert or update on public.beers
      deferrable initially deferred
      for each row execute function public.olnu_crew_beer_tg();
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Group state json (shared by crew_group and crew_poll)
-- ---------------------------------------------------------------------------
-- Replay window: 05:00-18:00 local on the day after the night, and at least one track point.
create or replace function public.olnu_crew_replay_open(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.olnu_crew_now() < public.olnu_crew_last_night(public.olnu_crew_now()) + interval '13 hours'
     and exists (select 1 from public.crew_tracks t join public.group_members m on m.user_id = t.user_id
                  where m.group_id = p_group and t.night = public.olnu_crew_last_night(public.olnu_crew_now()));
$$;

create or replace function public.olnu_crew_group_json(p_group uuid, p_uid uuid, p_full boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(now());
  v_mm jsonb; v_deps jsonb; v_dates jsonb := null; v_mood jsonb := null; v_alone jsonb := null;
  v_out int; v_gone int; v_me text;
  dp public.crew_date_polls; md public.crew_moods;
begin
  select coalesce(jsonb_agg(jsonb_build_object('uid', x.uid, 'k', x.k, 'name', x.name, 'is_me', x.is_me, 'state', x.state,
           'left_at', x.left_at, 'lat', x.lat, 'lng', x.lng, 'bar_name', x.bar_name, 'pres_at', x.pres_at)
           order by x.name), '[]'::jsonb)
    into v_mm from public.olnu_crew_members(p_group, p_uid) x;

  select count(*) filter (where r.state = 'out'), count(*) filter (where r.state in ('left', 'home', 'quiet')),
         max(r.state) filter (where r.is_me)
    into v_out, v_gone, v_me
    from jsonb_to_recordset(v_mm) as r(uid uuid, k text, name text, is_me boolean, state text);
  if v_out = 1 and v_gone >= 1 then
    select jsonb_build_object('k', r.k, 'name', r.name, 'is_me', r.is_me, 'bar_name', r.bar_name)
      into v_alone
      from jsonb_to_recordset(v_mm) as r(k text, name text, is_me boolean, state text, bar_name text)
     where r.state = 'out' limit 1;
  end if;

  -- Avgångstavlan: live departures tonight (until 15 min after the time)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'by', public.olnu_crew_name(p_group, d.user_id), 'is_mine', d.user_id = p_uid,
           'leave_at', d.leave_at, 'bar_id', d.bar_id, 'bar_name', d.bar_name, 'lat', d.lat, 'lng', d.lng,
           'created_at', d.created_at,
           'going_n', (select count(*) from public.crew_dep_going g join public.group_members m
                        on m.group_id = p_group and m.user_id = g.user_id where g.dep_id = d.id and g.going),
           'i_going', exists (select 1 from public.crew_dep_going g where g.dep_id = d.id and g.user_id = p_uid and g.going),
           'going_names', case when p_full then (select coalesce(jsonb_agg(m.display_name order by g.updated_at), '[]'::jsonb)
                              from public.crew_dep_going g join public.group_members m on m.group_id = p_group and m.user_id = g.user_id
                             where g.dep_id = d.id and g.going) end)
           order by d.leave_at), '[]'::jsonb)
    into v_deps
    from public.crew_deps d
   where d.group_id = p_group and d.night = v_night and d.cancelled_at is null and d.leave_at > now() - interval '15 minutes';

  -- Vilken kväll?: newest poll that has not ended
  select * into dp from public.crew_date_polls p where p.group_id = p_group and p.ends_at > now()
   order by p.id desc limit 1;
  if found then
    with opts as (
      select o.d, (select count(*) from public.crew_date_votes v join public.group_members m on m.group_id = p_group and m.user_id = v.user_id
                    where v.poll_id = dp.id and v.d = o.d and v.answer = 'kan') as kan,
                  (select count(*) from public.crew_date_votes v join public.group_members m on m.group_id = p_group and m.user_id = v.user_id
                    where v.poll_id = dp.id and v.d = o.d and v.answer = 'kanske') as kanske,
                  (select count(*) from public.crew_date_votes v join public.group_members m on m.group_id = p_group and m.user_id = v.user_id
                    where v.poll_id = dp.id and v.d = o.d and v.answer = 'nej') as nej,
                  (select v.answer from public.crew_date_votes v where v.poll_id = dp.id and v.d = o.d and v.user_id = p_uid) as my
        from unnest(dp.dates) as o(d)
    )
    select jsonb_build_object(
      'id', dp.id, 'title', dp.title, 'by', public.olnu_crew_name(p_group, dp.user_id), 'is_mine', dp.user_id = p_uid,
      'closed', dp.closed_at is not null, 'created_at', dp.created_at, 'ends_at', dp.ends_at,
      'voters', (select count(distinct v.user_id) from public.crew_date_votes v join public.group_members m
                  on m.group_id = p_group and m.user_id = v.user_id where v.poll_id = dp.id),
      'i_voted', exists (select 1 from public.crew_date_votes v where v.poll_id = dp.id and v.user_id = p_uid),
      'winner', (select o.d from opts o where o.kan + o.kanske > 0 order by o.kan desc, o.kanske desc, o.nej, o.d limit 1),
      'dates', (select jsonb_agg(jsonb_build_object('d', o.d, 'kan', o.kan, 'kanske', o.kanske, 'nej', o.nej, 'my', o.my,
                  'kan_names', case when p_full then (select coalesce(jsonb_agg(m.display_name order by v.updated_at), '[]'::jsonb)
                       from public.crew_date_votes v join public.group_members m on m.group_id = p_group and m.user_id = v.user_id
                      where v.poll_id = dp.id and v.d = o.d and v.answer = 'kan') end) order by o.d) from opts o))
      into v_dates;
  end if;

  -- Hur mår truppen?: newest live check (ends 40 min after start)
  select * into md from public.crew_moods x where x.group_id = p_group and x.ends_at > now() order by x.id desc limit 1;
  if found then
    with ans as (
      select a.user_id, a.answer, a.updated_at from public.crew_mood_answers a
        join public.group_members m on m.group_id = p_group and m.user_id = a.user_id
       where a.mood_id = md.id
    ), mm as (
      select * from jsonb_to_recordset(v_mm) as r(uid uuid, k text, name text, is_me boolean, state text,
                                                   lat float8, lng float8, bar_name text)
    )
    select jsonb_build_object(
      'id', md.id, 'by', public.olnu_crew_name(p_group, md.user_id), 'is_mine', md.user_id = p_uid,
      'created_at', md.created_at, 'ends_at', md.ends_at,
      'my', (select a.answer from ans a where a.user_id = p_uid),
      'bra', (select count(*) from ans a where a.answer = 'bra'),
      'snurr', (select count(*) from ans a where a.answer = 'snurr'),
      'hem', (select count(*) from ans a where a.answer = 'hem'),
      'answers', (select coalesce(jsonb_agg(jsonb_build_object(
          'k', m.k, 'name', m.name, 'is_me', m.is_me, 'answer', a.answer, 'at', a.updated_at, 'bar_name', m.bar_name,
          'near', case when a.answer = 'snurr' and m.lat is not null then
             (select coalesce(jsonb_agg(o.name order by public.olnu_dist_m(m.lat, m.lng, o.lat, o.lng)), '[]'::jsonb)
                from mm o where o.uid <> m.uid and o.state = 'out' and o.lat is not null
                 and public.olnu_dist_m(m.lat, m.lng, o.lat, o.lng) <= 400) end)
          order by a.updated_at), '[]'::jsonb)
          from ans a join mm m on m.uid = a.user_id),
      'waiting', (select count(*) from mm m where not exists (select 1 from ans a where a.user_id = m.uid)))
      into v_mood;
  end if;

  return jsonb_build_object(
    'id', p_group, 'name', (select g.name from public.groups g where g.id = p_group),
    'me_state', v_me, 'out_n', v_out, 'gone_n', v_gone, 'alone', v_alone,
    'deps', v_deps, 'dates', v_dates, 'mood', v_mood,
    'replay', public.olnu_crew_replay_open(p_group),
    'members', case when p_full then (select coalesce(jsonb_agg(jsonb_build_object('k', r.k, 'name', r.name, 'is_me', r.is_me,
                 'state', r.state, 'bar_name', r.bar_name, 'left_at', r.left_at, 'at', r.pres_at)), '[]'::jsonb)
                 from jsonb_to_recordset(v_mm) as r(k text, name text, is_me boolean, state text, bar_name text,
                                                    left_at timestamptz, pres_at timestamptz)) end);
end; $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- crew_group(group) -> full group state. Error: not_member.
create or replace function public.crew_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return public.olnu_crew_group_json(p_group_id, v_uid, true) || jsonb_build_object('server_time', now());
end; $$;

-- crew_poll(lat?, lng?) -> {v, server_time, night, me:{bye}, groups:[lite state], torch, offers:[torch]}
create or replace function public.crew_poll(p_lat float8 default null, p_lng float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_groups jsonb; v_torch jsonb := null; v_offers jsonb;
  tw record; v_tid bigint; r record;
begin
  select coalesce(jsonb_agg(public.olnu_crew_group_json(m.group_id, v_uid, false) order by m.joined_at), '[]'::jsonb)
    into v_groups
    from (select gm.group_id, gm.joined_at from public.group_members gm where gm.user_id = v_uid
           order by gm.joined_at limit 10) m;
  -- torches pending to one of my groups (any town) + the torch of my town
  for r in select t.id from public.crew_torches t
            where t.night = v_night and t.pending is not null
              and t.pending in (select gm.group_id from public.group_members gm where gm.user_id = v_uid) loop
    perform public.olnu_crew_torch_tick(r.id);
  end loop;
  select * into tw from public.olnu_crew_my_town(v_uid, p_lat, p_lng);
  if tw.key is not null then
    select t.id into v_tid from public.crew_torches t where t.town = tw.key and t.night = v_night;
    if v_tid is not null then
      perform public.olnu_crew_torch_tick(v_tid);
      v_torch := public.olnu_crew_torch_json(v_tid, v_uid, false);
    else
      v_torch := jsonb_build_object('id', null, 'town', tw.name, 'lit', false);
    end if;
  end if;
  select coalesce(jsonb_agg(public.olnu_crew_torch_json(t.id, v_uid, false)), '[]'::jsonb) into v_offers
    from public.crew_torches t
   where t.night = v_night and t.pending is not null and t.pending_until > now()
     and t.pending in (select gm.group_id from public.group_members gm where gm.user_id = v_uid);
  return jsonb_build_object('v', 1, 'server_time', now(), 'night', v_night,
    'me', jsonb_build_object('bye_at', (select y.at from public.crew_byes y where y.user_id = v_uid and y.night = v_night and y.cleared_at is null)),
    'groups', v_groups, 'torch', v_torch, 'offers', v_offers);
end; $$;

-- 1 Avgångstavlan --------------------------------------------------------------
-- crew_dep_set(group, leave_at, bar?) -> {id, leave_at}. Errors: not_member, invalid_time (not between
-- now-1 min and now+12 h), invalid_bar, slow_down (1 per 30 s per user), board_full (max 4 live per group).
-- A new departure by the same user in the same group replaces the older one. The creator is "Med!".
create or replace function public.crew_dep_set(p_group_id uuid, p_leave_at timestamptz, p_bar_id text default null,
                                               p_bar_name text default null, p_lat float8 default null, p_lng float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_bar text := public.olnu_crew_clean(p_bar_id, 200);
  v_name text := public.olnu_crew_clean(p_bar_name, 200);
  v_lat float8; v_lng float8; v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_leave_at is null or p_leave_at < now() - interval '1 minute' or p_leave_at > now() + interval '12 hours' then
    raise exception 'invalid_time';
  end if;
  if (v_bar is not null and char_length(v_bar) > 80) or (v_name is not null and char_length(v_name) > 60) then
    raise exception 'invalid_bar';
  end if;
  if public.olnu_world_ok(p_lat, p_lng) then
    v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_dep:' || p_group_id::text, 0));
  if exists (select 1 from public.crew_deps d where d.user_id = v_uid and d.created_at > now() - interval '30 seconds') then
    raise exception 'slow_down';
  end if;
  update public.crew_deps d set cancelled_at = now()
   where d.group_id = p_group_id and d.user_id = v_uid and d.night = v_night and d.cancelled_at is null;
  if (select count(*) from public.crew_deps d where d.group_id = p_group_id and d.night = v_night
         and d.cancelled_at is null and d.leave_at > now() - interval '15 minutes') >= 4 then
    raise exception 'board_full';
  end if;
  insert into public.crew_deps (group_id, user_id, night, leave_at, bar_id, bar_name, lat, lng)
  values (p_group_id, v_uid, v_night, date_trunc('minute', p_leave_at), v_bar, v_name, v_lat, v_lng)
  returning id into v_id;
  insert into public.crew_dep_going (dep_id, user_id, going) values (v_id, v_uid, true)
  on conflict (dep_id, user_id) do update set going = true, updated_at = now();
  return jsonb_build_object('id', v_id, 'leave_at', date_trunc('minute', p_leave_at));
end; $$;

-- crew_dep_join(dep, on) -> {going_n, i_going}. Errors: dep_not_found, not_member.
create or replace function public.crew_dep_join(p_dep_id bigint, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  d public.crew_deps;
begin
  select * into d from public.crew_deps x where x.id = p_dep_id and x.cancelled_at is null
     and x.night = public.olnu_night_of(now()) and x.leave_at > now() - interval '15 minutes';
  if not found then raise exception 'dep_not_found'; end if;
  if not public.olnu_crew_member(d.group_id, v_uid) then raise exception 'not_member'; end if;
  insert into public.crew_dep_going (dep_id, user_id, going) values (d.id, v_uid, coalesce(p_on, true))
  on conflict (dep_id, user_id) do update set going = excluded.going, updated_at = now();
  return jsonb_build_object('i_going', coalesce(p_on, true),
    'going_n', (select count(*) from public.crew_dep_going g join public.group_members m
                 on m.group_id = d.group_id and m.user_id = g.user_id where g.dep_id = d.id and g.going));
end; $$;

-- crew_dep_cancel(dep) -> {ok}. Creator only (else dep_not_found).
create or replace function public.crew_dep_cancel(p_dep_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  update public.crew_deps d set cancelled_at = coalesce(d.cancelled_at, now()) where d.id = p_dep_id and d.user_id = v_uid;
  if not found then raise exception 'dep_not_found'; end if;
  return jsonb_build_object('ok', true);
end; $$;

-- 2 Vilken kväll? --------------------------------------------------------------
-- crew_dates_create(group, dates[], title?) -> {id}. 2-5 distinct dates from tonight's evening date up to
-- +90 days, title max 40. Errors: not_member, invalid_dates, invalid_msg, slow_down (1 per 2 min per user).
-- Closes the group's older open poll. The poll ends at 05:00 after its last date.
create or replace function public.crew_dates_create(p_group_id uuid, p_dates date[], p_title text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_today date := public.olnu_evening(public.olnu_night_of(now()));
  v_dates date[]; v_title text := public.olnu_crew_clean(p_title, 200); v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select array_agg(distinct x order by x) into v_dates from unnest(coalesce(p_dates, '{}'::date[])) x where x is not null;
  if v_dates is null or array_length(v_dates, 1) < 2 or array_length(v_dates, 1) > 5
     or v_dates[1] < v_today or v_dates[array_length(v_dates, 1)] > v_today + 90 then
    raise exception 'invalid_dates';
  end if;
  if v_title is not null and char_length(v_title) > 40 then raise exception 'invalid_msg'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_dates:' || v_uid::text, 0));
  if exists (select 1 from public.crew_date_polls p where p.user_id = v_uid and p.created_at > now() - interval '2 minutes') then
    raise exception 'slow_down';
  end if;
  update public.crew_date_polls p set closed_at = now()
   where p.group_id = p_group_id and p.closed_at is null and p.ends_at > now();
  insert into public.crew_date_polls (group_id, user_id, title, dates, ends_at)
  values (p_group_id, v_uid, v_title, v_dates,
          ((v_dates[array_length(v_dates, 1)] + 1)::timestamp + interval '5 hours') at time zone 'Europe/Stockholm')
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end; $$;

-- crew_dates_vote(poll, date, answer kan|kanske|nej) -> {ok, d, answer}.
-- Errors: invalid_answer (checked first), poll_not_found (closed/ended/unknown), not_member, invalid_dates.
create or replace function public.crew_dates_vote(p_poll_id bigint, p_date date, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_answer, '')));
  p public.crew_date_polls;
begin
  if v_a not in ('kan', 'kanske', 'nej') then raise exception 'invalid_answer'; end if;
  select * into p from public.crew_date_polls x where x.id = p_poll_id and x.closed_at is null and x.ends_at > now();
  if not found then raise exception 'poll_not_found'; end if;
  if not public.olnu_crew_member(p.group_id, v_uid) then raise exception 'not_member'; end if;
  if p_date is null or not (p_date = any (p.dates)) then raise exception 'invalid_dates'; end if;
  insert into public.crew_date_votes (poll_id, user_id, d, answer) values (p.id, v_uid, p_date, v_a)
  on conflict (poll_id, user_id, d) do update set answer = excluded.answer, updated_at = now();
  return jsonb_build_object('ok', true, 'd', p_date, 'answer', v_a);
end; $$;

-- crew_dates_close(poll) -> {ok}. Creator only (else poll_not_found). The result stays visible.
create or replace function public.crew_dates_close(p_poll_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  update public.crew_date_polls p set closed_at = coalesce(p.closed_at, now())
   where p.id = p_poll_id and p.user_id = v_uid and p.ends_at > now();
  if not found then raise exception 'poll_not_found'; end if;
  return jsonb_build_object('ok', true);
end; $$;

-- 3 Ingen lämnas kvar ----------------------------------------------------------
-- crew_bye(on default true) -> {ok, bye_at}. "Hej då" for tonight (all groups). on=false = "Jag ä kvar ändå".
create or replace function public.crew_bye(p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_at timestamptz;
begin
  if coalesce(p_on, true) then
    insert into public.crew_byes (user_id, night, at) values (v_uid, v_night, now())
    on conflict (user_id, night) do update set at = now(), cleared_at = null;
    v_at := now();
  else
    update public.crew_byes y set cleared_at = now() where y.user_id = v_uid and y.night = v_night;
  end if;
  return jsonb_build_object('ok', true, 'bye_at', v_at);
end; $$;

-- 4 Dansgolvsmätaren -----------------------------------------------------------
-- crew_dance_report(bar, bar point, my point, level 0|1|2) -> {ok, wait_seconds, level, n, avg}
-- Errors: invalid_level, invalid_bar, outside_sweden (= invalid coordinates), too_far (> 300 m).
-- 1 report per user per bar per 10 min (ok=false + wait_seconds). A report lives 30 min.
create or replace function public.crew_dance_report(p_bar_id text, p_bar_name text, p_bar_lat float8, p_bar_lng float8,
                                                    p_lat float8, p_lng float8, p_level int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_bar text := public.olnu_crew_clean(p_bar_id, 200);
  v_blat float8 := p_bar_lat; v_blng float8 := p_bar_lng;
  v_last timestamptz; s jsonb;
begin
  if p_level is null or p_level not in (0, 1, 2) then raise exception 'invalid_level'; end if;
  if v_bar is null or char_length(v_bar) > 80 then raise exception 'invalid_bar'; end if;
  select bl.lat, bl.lng into v_blat, v_blng from public.bars_lite bl where bl.id = v_bar;
  if v_blat is null then v_blat := p_bar_lat; v_blng := p_bar_lng; end if;
  if not public.olnu_world_ok(v_blat, v_blng) or not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  if public.olnu_dist_m(v_blat, v_blng, p_lat, p_lng) > 300 then raise exception 'too_far'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_dance:' || v_uid::text, 0));
  select max(d.created_at) into v_last from public.crew_dance d where d.user_id = v_uid and d.bar_id = v_bar;
  if v_last is not null and v_last > now() - interval '10 minutes' then
    s := public.olnu_crew_dance_json(v_bar);
    return s || jsonb_build_object('ok', false,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + interval '10 minutes' - now())))::int));
  end if;
  insert into public.crew_dance (bar_id, user_id, level, bar_lat, bar_lng, expires_at)
  values (v_bar, v_uid, p_level, round(v_blat::numeric, 5)::float8, round(v_blng::numeric, 5)::float8, now() + interval '30 minutes');
  return public.olnu_crew_dance_json(v_bar) || jsonb_build_object('ok', true, 'wait_seconds', 0);
end; $$;

-- Meter of a bar: newer reports weigh more (weight 1 at 0 min -> 0.5 at 30 min). level = rounded avg.
create or replace function public.olnu_crew_dance_json(p_bar text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'n', count(*),
    'avg', case when count(*) > 0 then round((sum(d.level * w) / sum(w))::numeric, 2) end,
    'level', case when count(*) > 0 then round(sum(d.level * w) / sum(w))::int end,
    'at', max(d.created_at))
  from (select x.level, x.created_at,
               (1.0 - least(1.0, extract(epoch from (now() - x.created_at)) / 1800.0) * 0.5) as w
          from public.crew_dance x where x.bar_id = p_bar and x.expires_at > now()) d;
$$;

-- crew_dance_bar(bar) -> {n, avg, level, at, wait_seconds (own 10-min limit)}
create or replace function public.crew_dance_bar(p_bar_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_last timestamptz;
begin
  select max(d.created_at) into v_last from public.crew_dance d where d.user_id = v_uid and d.bar_id = p_bar_id;
  return public.olnu_crew_dance_json(p_bar_id) || jsonb_build_object('wait_seconds',
    case when v_last > now() - interval '10 minutes'
         then greatest(1, ceil(extract(epoch from (v_last + interval '10 minutes' - now())))::int) else 0 end);
end; $$;

-- 5 Skålstafetten --------------------------------------------------------------
-- crew_torch(lat?, lng?) -> torch state of the caller's town (own pin/check-in first, else the point):
-- {id, town, passes, holder{name,mine}, holder_bar, holder_group, pending{to,to_group,from,at,until}|null,
--  hops:[{at, how, bar_name, lat, lng, to{name,mine}, by}], cands:[{key, label, bar_name, n}], lit,
--  my_groups:[{id, name, n}] (my groups out in this town, for lighting)} / {lit:false, town, my_groups} / {town:null}
create or replace function public.crew_torch(p_lat float8 default null, p_lng float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  tw record; v_tid bigint; v_my jsonb;
begin
  select * into tw from public.olnu_crew_my_town(v_uid, p_lat, p_lng);
  if tw.key is null then return jsonb_build_object('town', null, 'lit', false, 'no_town', true, 'my_groups', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', g.group_id, 'name', (select x.name from public.groups x where x.id = g.group_id), 'n', g.n)), '[]'::jsonb)
    into v_my from public.olnu_crew_town_groups(tw.key, tw.lat, tw.lng) g
   where public.olnu_crew_member(g.group_id, v_uid);
  select t.id into v_tid from public.crew_torches t where t.town = tw.key and t.night = v_night;
  if v_tid is null then
    return jsonb_build_object('town', tw.name, 'lit', false, 'my_groups', v_my);
  end if;
  perform public.olnu_crew_torch_tick(v_tid);
  return public.olnu_crew_torch_json(v_tid, v_uid, true) || jsonb_build_object('lit', true, 'my_groups', v_my);
end; $$;

-- crew_torch_light(group, lat?, lng?) -> {ok, already, id}. Lights tonight's torch of the caller's town for
-- the group. The group must have a member out in that town. Errors: not_member, no_town, not_out.
create or replace function public.crew_torch_light(p_group_id uuid, p_lat float8 default null, p_lng float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  tw record; g record; v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into tw from public.olnu_crew_my_town(v_uid, p_lat, p_lng);
  if tw.key is null then raise exception 'no_town'; end if;
  select * into g from public.olnu_crew_town_groups(tw.key, tw.lat, tw.lng) x where x.group_id = p_group_id;
  if g.group_id is null then raise exception 'not_out'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_torch_town:' || tw.key || v_night::text, 0));
  select t.id into v_id from public.crew_torches t where t.town = tw.key and t.night = v_night;
  if v_id is not null then return jsonb_build_object('ok', false, 'already', true, 'id', v_id); end if;
  insert into public.crew_torches (town, town_name, c_lat, c_lng, night, holder)
  values (tw.key, tw.name, tw.lat, tw.lng, v_night, p_group_id) returning id into v_id;
  insert into public.crew_torch_hops (torch_id, from_group, to_group, how, by_user, bar_id, bar_name, lat, lng)
  values (v_id, null, p_group_id, 'light', v_uid, g.bar_id, g.bar_name, g.bar_lat, g.bar_lng);
  return jsonb_build_object('ok', true, 'already', false, 'id', v_id);
end; $$;

-- crew_torch_pass(group, key) -> {ok, until}. The holder group passes the torch to another group out in
-- town (key from cands). Errors: not_member, no_torch (group holds no torch tonight), torch_pending, invalid_target.
create or replace function public.crew_torch_pass(p_group_id uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t public.crew_torches; c record;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into t from public.crew_torches x where x.holder = p_group_id and x.night = public.olnu_night_of(now())
   order by x.updated_at desc limit 1;
  if not found then raise exception 'no_torch'; end if;
  perform public.olnu_crew_torch_tick(t.id);
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_torch:' || t.id::text, 0));
  select * into t from public.crew_torches x where x.id = t.id;
  if t.holder is distinct from p_group_id then raise exception 'no_torch'; end if;
  if t.pending is not null then raise exception 'torch_pending'; end if;
  select * into c from public.olnu_crew_town_groups(t.town, t.c_lat, t.c_lng) g
   where g.group_id <> t.holder and left(md5('crewt:' || t.id::text || ':' || g.group_id::text), 12) = p_key;
  if c.group_id is null then raise exception 'invalid_target'; end if;
  update public.crew_torches x set pending = c.group_id, pending_from = p_group_id, pending_at = now(),
         pending_until = now() + interval '10 minutes', updated_at = now() where x.id = t.id;
  return jsonb_build_object('ok', true, 'until', now() + interval '10 minutes');
end; $$;

-- crew_torch_answer(group, accept) -> {ok, holder}. A member of the group the torch is offered to takes it
-- (accept) or lets it go on (it then moves to a random other group in town). Errors: not_member, no_offer.
create or replace function public.crew_torch_answer(p_group_id uuid, p_accept boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t public.crew_torches; g record;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into t from public.crew_torches x where x.pending = p_group_id and x.night = public.olnu_night_of(now())
   order by x.pending_at desc limit 1;
  if not found then raise exception 'no_offer'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_torch:' || t.id::text, 0));
  select * into t from public.crew_torches x where x.id = t.id;
  if t.pending is distinct from p_group_id or t.pending_until <= now() then
    perform public.olnu_crew_torch_tick(t.id);
    raise exception 'no_offer';
  end if;
  if not coalesce(p_accept, true) then
    perform public.olnu_crew_torch_move(t.id, p_group_id);
    return jsonb_build_object('ok', true, 'holder', false);
  end if;
  select * into g from public.olnu_crew_town_groups(t.town, t.c_lat, t.c_lng) x where x.group_id = p_group_id;
  insert into public.crew_torch_hops (torch_id, from_group, to_group, how, by_user, bar_id, bar_name, lat, lng)
  values (t.id, t.holder, p_group_id, 'pass', v_uid, g.bar_id, g.bar_name, g.bar_lat, g.bar_lng);
  update public.crew_torches x set holder = p_group_id, pending = null, pending_from = null, pending_at = null,
         pending_until = null, passes = x.passes + 1, updated_at = now() where x.id = t.id;
  return jsonb_build_object('ok', true, 'holder', true);
end; $$;

-- 6 Kvällsrepris ---------------------------------------------------------------
-- crew_replay(group) -> {available:false, opens_at} or {available:true, night, evening, members:[{k,name,is_me}],
-- points:[{k, at, lat, lng, bar_name, kind}], summary:{...}}. Members only; current members' points of last
-- night; bar points / ~550 m grid points only. Open 05:00-18:00 local the day after. Error: not_member.
create or replace function public.crew_replay(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_crew_now();
  v_last timestamptz := public.olnu_crew_last_night(v_now);
  v_pts jsonb; v_mem jsonb; v_sum jsonb;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_now >= v_last + interval '13 hours' then
    return jsonb_build_object('available', false, 'opens_at', public.olnu_night_of(v_now));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_crew_k(p_group_id, t.user_id), 'at', t.at,
           'lat', t.lat, 'lng', t.lng, 'bar_name', t.bar_name, 'kind', t.kind) order by t.at, t.id), '[]'::jsonb)
    into v_pts
    from (select x.* from public.crew_tracks x join public.group_members m on m.group_id = p_group_id and m.user_id = x.user_id
           where x.night = v_last order by x.at limit 1500) t;
  if jsonb_array_length(v_pts) = 0 then
    return jsonb_build_object('available', false, 'empty', true, 'opens_at', public.olnu_night_of(v_now));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_crew_k(p_group_id, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = v_uid,
           'home_at', (select an.home_at from public.after_nights an where an.user_id = m.user_id and an.night = v_last),
           'bye_at', (select y.at from public.crew_byes y where y.user_id = m.user_id and y.night = v_last and y.cleared_at is null))
           order by m.joined_at), '[]'::jsonb)
    into v_mem from public.group_members m
   where m.group_id = p_group_id
     and exists (select 1 from public.crew_tracks x where x.user_id = m.user_id and x.night = v_last);
  select jsonb_build_object(
    'members_out', count(distinct x.user_id),
    'bars', count(distinct x.bar_id) filter (where x.bar_id is not null),
    'checkins', count(*) filter (where x.kind = 'ci'),
    'points', count(*),
    'first_at', min(x.at), 'last_at', max(x.at),
    'top_bar', (select y.bar_name from public.crew_tracks y join public.group_members m2 on m2.group_id = p_group_id and m2.user_id = y.user_id
                 where y.night = v_last and y.bar_name is not null
                 group by y.bar_name order by count(distinct y.user_id) desc, count(*) desc limit 1),
    'torch', (select count(*) from public.crew_torch_hops h join public.crew_torches tt on tt.id = h.torch_id
               where h.to_group = p_group_id and tt.night = v_last))
    into v_sum
    from public.crew_tracks x join public.group_members m on m.group_id = p_group_id and m.user_id = x.user_id
   where x.night = v_last;
  return jsonb_build_object('available', true, 'night', v_last, 'evening', public.olnu_evening(v_last),
    'members', v_mem, 'points', v_pts, 'summary', v_sum);
end; $$;

-- 7 Hur mår truppen? -----------------------------------------------------------
-- crew_mood_start(group) -> {id, already}. A live check of the group is reused (already=true).
-- Max 1 new check per user per 10 min (slow_down). Lives 40 min. The starter is not auto-answered.
create or replace function public.crew_mood_start(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_mood:' || p_group_id::text, 0));
  select x.id into v_id from public.crew_moods x where x.group_id = p_group_id and x.ends_at > now() order by x.id desc limit 1;
  if v_id is not null then return jsonb_build_object('id', v_id, 'already', true); end if;
  if exists (select 1 from public.crew_moods x where x.user_id = v_uid and x.created_at > now() - interval '10 minutes') then
    raise exception 'slow_down';
  end if;
  insert into public.crew_moods (group_id, user_id, night, ends_at)
  values (p_group_id, v_uid, public.olnu_night_of(now()), now() + interval '40 minutes') returning id into v_id;
  return jsonb_build_object('id', v_id, 'already', false);
end; $$;

-- crew_mood_answer(check, answer bra|snurr|hem) -> {ok, answer}. Errors: invalid_answer, mood_not_found, not_member.
create or replace function public.crew_mood_answer(p_mood_id bigint, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_answer, '')));
  md public.crew_moods;
begin
  if v_a not in ('bra', 'snurr', 'hem') then raise exception 'invalid_answer'; end if;
  select * into md from public.crew_moods x where x.id = p_mood_id and x.ends_at > now();
  if not found then raise exception 'mood_not_found'; end if;
  if not public.olnu_crew_member(md.group_id, v_uid) then raise exception 'not_member'; end if;
  insert into public.crew_mood_answers (mood_id, user_id, answer) values (md.id, v_uid, v_a)
  on conflict (mood_id, user_id) do update set answer = excluded.answer, updated_at = now();
  return jsonb_build_object('ok', true, 'answer', v_a);
end; $$;

-- ---------------------------------------------------------------------------
-- Grants: helpers for nobody, RPCs for authenticated only.
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_crew_clean(text, int), public.olnu_crew_k(uuid, uuid), public.olnu_crew_member(uuid, uuid), '
    || 'public.olnu_crew_name(uuid, uuid), public.olnu_crew_now(), public.olnu_crew_last_night(timestamptz), '
    || 'public.olnu_crew_town(float8, float8), public.olnu_crew_pres(uuid), public.olnu_crew_members(uuid, uuid), '
    || 'public.olnu_crew_town_groups(text, float8, float8), public.olnu_crew_glabel(uuid, uuid), '
    || 'public.olnu_crew_torch_move(bigint, uuid), public.olnu_crew_torch_tick(bigint), '
    || 'public.olnu_crew_my_town(uuid, float8, float8), public.olnu_crew_torch_json(bigint, uuid, boolean), '
    || 'public.olnu_crew_track_add(uuid, text, text, text, float8, float8), public.olnu_crew_ci_tg(), public.olnu_crew_beer_tg(), '
    || 'public.olnu_crew_replay_open(uuid), public.olnu_crew_group_json(uuid, uuid, boolean), public.olnu_crew_dance_json(text)';
  v_rpcs text := 'public.crew_group(uuid), public.crew_poll(float8, float8), '
    || 'public.crew_dep_set(uuid, timestamptz, text, text, float8, float8), public.crew_dep_join(bigint, boolean), '
    || 'public.crew_dep_cancel(bigint), public.crew_dates_create(uuid, date[], text), '
    || 'public.crew_dates_vote(bigint, date, text), public.crew_dates_close(bigint), public.crew_bye(boolean), '
    || 'public.crew_dance_report(text, text, float8, float8, float8, float8, int), public.crew_dance_bar(text), '
    || 'public.crew_torch(float8, float8), public.crew_torch_light(uuid, float8, float8), public.crew_torch_pass(uuid, text), '
    || 'public.crew_torch_answer(uuid, boolean), public.crew_replay(uuid), public.crew_mood_start(uuid), '
    || 'public.crew_mood_answer(bigint, text)';
begin
  execute 'revoke all on function ' || v_helpers || ' from public';
  execute 'revoke all on function ' || v_rpcs || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_helpers || ' from anon';
    execute 'revoke all on function ' || v_rpcs || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_helpers || ' from authenticated';
    execute 'grant execute on function ' || v_rpcs || ' to authenticated';
  end if;
end $$;
