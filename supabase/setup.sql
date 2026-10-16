-- Öl Nu: full database setup. Paste ALL of this into Supabase → SQL Editor → Run. Safe to run again.
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

-- Öl Nu v5: shots + 10 min beer cooldown. Additive. Safe to run again.
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
    'expires_at', v_row.expires_at, 'milestone', v_milestone, 'shot_count', v_row.shot_count);
end; $$;

create or replace function public.post_shot(p_lat float8, p_lng float8, p_precise bool)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_precise boolean := coalesce(p_precise, false);
  v_lat float8; v_lng float8;
  v_row public.beers%rowtype;
  v_is_new boolean := false;
  v_accepted boolean := true;
  v_wait int := 0;
  v_cooldown constant interval := interval '15 minutes';
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
    if v_row.shot_at is not null and v_row.shot_at > now() - v_cooldown then
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (v_row.shot_at + v_cooldown - now())))::int);
    else
      update public.beers set lat = v_lat, lng = v_lng, precise = v_precise,
             shot_count = shot_count + 1, shot_at = now(), updated_at = now(), stopped = false
       where id = v_row.id returning * into v_row;
    end if;
  else
    insert into public.beers (user_id, lat, lng, precise, expires_at, beer_count, shot_count, shot_at)
    values (v_uid, v_lat, v_lng, v_precise, public.olnu_next_expiry(), 0, 1, now())
    on conflict (user_id) do nothing returning * into v_row;
    if v_row.id is not null then
      v_is_new := true;
    else
      select * into v_row from public.beers where user_id = v_uid;
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (coalesce(v_row.shot_at, now()) + v_cooldown - now())))::int);
    end if;
  end if;
  return json_build_object('accepted', v_accepted, 'wait_seconds', v_wait, 'id', v_row.id,
    'lat', v_row.lat, 'lng', v_row.lng, 'beer_count', v_row.beer_count, 'shot_count', v_row.shot_count,
    'is_new', v_is_new, 'expires_at', v_row.expires_at);
end; $$;

drop function if exists public.live_beers();
create or replace function public.live_beers()
returns table (id bigint, lat float8, lng float8, beer_count int, precise bool, created_at timestamptz,
               is_mine bool, friend_name text, skal_count int, i_skaled bool, shot_count int)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  return query
  select b.id, b.lat, b.lng, b.beer_count, b.precise, b.created_at,
         (b.user_id = v_uid),
         case when b.user_id = v_uid then null
              else (select min(am.display_name) from public.group_members am
                      join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
                     where am.user_id = b.user_id) end,
         (select count(*)::int from public.skals s where s.beer_id = b.id),
         exists (select 1 from public.skals s where s.beer_id = b.id and s.user_id = v_uid),
         b.shot_count
    from public.beers b
   where b.expires_at > now() and not b.stopped
   order by b.created_at;
end; $$;

revoke all on function public.post_beer(float8, float8, bool), public.post_shot(float8, float8, bool), public.live_beers() from public, anon;
grant execute on function public.post_beer(float8, float8, bool), public.post_shot(float8, float8, bool), public.live_beers() to authenticated;

-- Öl Nu: review fixes. Additive. Safe to run again. Run after 0003_shots.sql.
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
