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
