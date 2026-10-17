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
