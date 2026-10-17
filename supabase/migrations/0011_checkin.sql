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
