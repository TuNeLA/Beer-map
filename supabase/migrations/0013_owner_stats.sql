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
