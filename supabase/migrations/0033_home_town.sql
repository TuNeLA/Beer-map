-- 0033 v25 HEMSTAD ("Var är du mest baserad?"). Client: docs/js/hometown.js (window.HOMETOWN) + docs/hometown.css.
-- Each user may set one home town (free text 1-30 chars, letters/digits/space and . , ' ’ ( ) & / -).
-- The client turns it into a demonym label ("Ludvikabo", "Smedjebackare", fallback "från {stad}").
-- The town is shown only where the user's name is shown already:
--   * group_status_v2 / chief_state (members of a shared group; 0034),
--   * local_board_v2 / wall_of_fame_v2 (only when the board name is shown, i.e. the user opted in).
-- Additive only. Old RPCs keep their shape (RETURNS TABLE functions cannot grow, so the boards get _v2 twins).
-- RLS on, no policies. All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only.
-- "Radera allt om mig" (0016c generic uuid sweep) moves user_home.user_id to a fresh id, so the town detaches.
-- Safe to run again.

create table if not exists public.user_home (
  user_id    uuid primary key,
  town       text null,
  updated_at timestamptz not null default now(),
  changes    int not null default 0
);
alter table public.user_home enable row level security;
revoke all on table public.user_home from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.user_home from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.user_home from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.user_home to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
-- Clean a town: control chars -> space, collapse spaces, trim. Returns '' for empty, null when invalid.
create or replace function public.olnu_clean_town(p text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v text := btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
begin
  if v = '' then return ''; end if;
  if char_length(v) > 30 then return null; end if;
  if v !~ '^[[:alpha:][:digit:] .,''’()&/-]+$' then return null; end if;
  if v !~ '[[:alpha:]]' then return null; end if;
  return v;
end; $$;

create or replace function public.olnu_home_town(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select h.town from public.user_home h where h.user_id = p_uid;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- set_home_town(p_town) -> jsonb {town}. '' or null clears it. Errors: invalid_town, slow_down (1 per 3 s, 40 per day).
create or replace function public.set_home_town(p_town text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_town text := public.olnu_clean_town(p_town);
  h      public.user_home;
begin
  if v_town is null then raise exception 'invalid_town'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_home:' || v_uid::text, 0));
  select * into h from public.user_home x where x.user_id = v_uid;
  if found then
    if h.updated_at > now() - interval '3 seconds' then raise exception 'slow_down'; end if;
    if h.updated_at > now() - interval '1 day' and h.changes >= 40 then raise exception 'slow_down'; end if;
    update public.user_home x
       set town = nullif(v_town, ''), updated_at = now(),
           changes = case when x.updated_at > now() - interval '1 day' then x.changes + 1 else 1 end
     where x.user_id = v_uid;
  else
    insert into public.user_home (user_id, town, updated_at, changes) values (v_uid, nullif(v_town, ''), now(), 1);
  end if;
  return jsonb_build_object('town', nullif(v_town, ''));
end; $$;

-- my_home_town() -> jsonb {town}
create or replace function public.my_home_town()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return jsonb_build_object('town', public.olnu_home_town(v_uid));
end; $$;

-- local_board_v2: local_board (0023) + home_town at the end (null when the name is hidden).
create or replace function public.local_board_v2(p_lat double precision, p_lng double precision, p_km double precision default 20, p_period text default 'tonight')
returns table(rank integer, name text, total integer, nights integer, is_me boolean, home_town text)
language plpgsql security definer set search_path = public as $function$
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
  ),
  named as (
    select r.*, public.olnu_board_name(r.uid) as nm from ranked r where r.rn <= 10 or r.uid = v_uid
  )
  select x.rk, x.nm, x.d, x.nn, x.uid = v_uid,
         case when x.nm is not null then public.olnu_home_town(x.uid) end
    from named x
   order by x.rn;
end; $function$;

-- wall_of_fame_v2: wall_of_fame (0023) + home_town at the end (null when the name is hidden).
create or replace function public.wall_of_fame_v2(p_lat double precision, p_lng double precision, p_km double precision default 20)
returns table(category text, name text, value integer, is_me boolean, top boolean, home_town text)
language plpgsql security definer set search_path = public as $function$
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
  ),
  named as (
    select r.*, public.olnu_board_name(r.uid) as nm from ranked r where r.rn = 1 or r.uid = v_uid
  )
  select x.cat, x.nm, x.v, x.uid = v_uid, x.rn = 1,
         case when x.nm is not null then public.olnu_home_town(x.uid) end
    from named x
   order by array_position(array['best_night', 'nights', 'bars', 'stammis', 'skal', 'home'], x.cat), x.rn;
end; $function$;

-- ---------------------------------------------------------------------------
-- Grants: helpers nobody, RPCs authenticated only
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_clean_town(text), public.olnu_home_town(uuid)';
  v_rpcs text := 'public.set_home_town(text), public.my_home_town(), '
    || 'public.local_board_v2(double precision, double precision, double precision, text), '
    || 'public.wall_of_fame_v2(double precision, double precision, double precision)';
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
