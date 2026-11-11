-- 0485 HEAT · anonymous heat = "Bars + town centre" (owner choice 11 Nov 21:05). OWNER-RUN at release, AFTER 0430/0431/0436.
-- Additive: new table, new nullable columns, new functions, CREATE OR REPLACE with the same signatures. No row or object is
-- removed. Safe to run twice. Safe to paste with CR LF line ends (no anchor patches; olnu_strip_cr() runs at the end).
--
-- Problem (live 11 Nov): heat_points / poll heat (olnu_heat) showed a ~55 m cell, or its ~550 m grid point when the cell had
-- fewer than 3 beers. (1) One beer at home in a small village still glowed ~550 m from the house. (2) The drinker, his group
-- and his friends saw his real pin AND a second anonymous glow (looks like one more person).
--
-- Rules after this file (one anonymous heat point per beer event, weight 1 / 2 (n >= 5) / 3 (n >= 10) as before):
--   (a) BAR: a precise beer at a known bar (olnu_near_bar: 75 m bars, 40 m restaurants, 110 m arenas), or <= 100 m from a
--       bar / pub / nightclub / biergarten, or <= 1 km from the bar of the drinker's active check-in -> heat at that bar.
--   (b) TOWN: any other beer -> weight at the centre of the NEAREST town that has bars (table olnu_heat_towns, <= 60 km).
--       No town in 60 km -> no heat. There are no other heat points: never a home cell, never a grid point.
--   (c) A viewer never gets anonymous heat for a beer whose pin he already sees: his own, his group mates' (any shared group,
--       same rule as olnu_pins) and his accepted friends' (0340 Vänner). Blocked either way (user_blocks): never.
--   "Bara vänner" (olnu_visibility.friends_only): strangers get only the rule (b) town weight, never the bar.
--   Spökläge: a hidden beer has no beer event (as before). A beer row in ghost mode (beers.ghost) also takes its earlier
--   events of that night out of the heat: NOT moved to the town (a town weight is still "someone drinks here").
--   Pin gone = heat gone (owner 23:07): when the beer row is stopped (stop_beer: "Jag är hemma", Spöke, hidden pin) or
--   gone (data erased), tonight's events of that row give no heat (at once, next poll). The beer count does not change.
--   ghost_points / ghost_points2 (yesterday's clouds, 1-3 days old): rules (a) + (b) + Bara vänner + Spökläge + blocks (no pin
--   exists, so rule (c) does not apply there).
-- Town centres (olnu_heat_towns): (1) every olnu_towns row (curated centre, 0018) with >= 1 bar-type venue <= 3 km;
--   (2) elsewhere: bars with >= 3 bar-type venues <= 2 km ("core" bars), grouped per ~5 km grid cell -> centroid of the core
--   bars. Refreshed by olnu_heat_towns_refresh(); olnu_resnap() (run after every bar data load) now also runs it.
-- Answer shapes do not change: heat_points(), olnu_heat(box, limit), ghost_points(), ghost_points2(); poll_v2 / poll_public /
-- rpc_bundle2 call them unchanged. The viewer is auth.uid() (heat_points, poll_v2 and rpc_bundle2 run with the user's JWT;
-- poll_public = no user = a stranger).
-- Check after the run (expect one row: ok heat0485 | towns > 0):
--   select 'ok heat0485', (select count(*) from public.olnu_heat_towns where active) as towns;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Town centres with bars
create table if not exists public.olnu_heat_towns (
  key        text primary key,            -- 't:<olnu_towns name>' or 'g:<cell>'
  name       text,
  lat        double precision not null,
  lng        double precision not null,
  n_bars     integer not null default 0,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.olnu_heat_towns enable row level security;
create index if not exists olnu_heat_towns_lat_lng_idx on public.olnu_heat_towns (lat, lng) where active;

-- 2. Per beer event: the beer row (bid) and the two places the heat may go (bar / town). Filled on insert.
alter table public.beer_events add column if not exists bid  bigint;
alter table public.beer_events add column if not exists blat double precision;
alter table public.beer_events add column if not exists blng double precision;
alter table public.beer_events add column if not exists tlat double precision;
alter table public.beer_events add column if not exists tlng double precision;
-- the town centre of each beer row (for 0486: strangers see a home pin at the town centre). Invisible until 0486 runs.
alter table public.beers add column if not exists tlat double precision;
alter table public.beers add column if not exists tlng double precision;

-- distance in metres (flat earth; fine below ~100 km)
create or replace function public.olnu_heat_m(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
returns double precision language sql immutable set search_path to 'public' as $$
  select sqrt(power((p_lat1 - p_lat2) * 111195, 2) + power((p_lng1 - p_lng2) * 111195 * cos(radians(p_lat1)), 2));
$$;

create or replace function public.olnu_heat_towns_refresh()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  -- every row of the new set gets updated_at = now() (the transaction time); older active rows are no longer towns
  insert into public.olnu_heat_towns as h (key, name, lat, lng, n_bars, active, updated_at)
  with b as (
    select bl.lat, bl.lng from public.bars_lite bl
     where bl.active and coalesce(bl.type, '') in ('bar', 'pub', 'nightclub', 'biergarten')
  ),
  named as (
    select t.name, t.lat, t.lng,
           (select count(*) from b
             where b.lat between t.lat - 0.03 and t.lat + 0.03
               and b.lng between t.lng - 0.03 / cos(radians(t.lat)) and t.lng + 0.03 / cos(radians(t.lat))
               and public.olnu_heat_m(t.lat, t.lng, b.lat, b.lng) <= 3000)::int as n
      from public.olnu_towns t
  ),
  nq as (select * from named where n >= 1),
  core as (
    select b.lat, b.lng from b
     where (select count(*) from b b2
             where b2.lat between b.lat - 0.02 and b.lat + 0.02
               and b2.lng between b.lng - 0.02 / cos(radians(b.lat)) and b.lng + 0.02 / cos(radians(b.lat))
               and public.olnu_heat_m(b.lat, b.lng, b2.lat, b2.lng) <= 2000) >= 3
       and not exists (select 1 from nq
                        where nq.lat between b.lat - 0.04 and b.lat + 0.04
                          and public.olnu_heat_m(b.lat, b.lng, nq.lat, nq.lng) <= 4000)
  ),
  cells as (
    select 'g:' || round(c.lat / 0.05)::int || ':' || round(c.lng / 0.1)::int as key,
           avg(c.lat) as lat, avg(c.lng) as lng, count(*)::int as n
      from core c group by 1
  )
  select 't:' || nq.name, nq.name, nq.lat, nq.lng, nq.n, true, now() from nq
  union all
  select cells.key, null, cells.lat, cells.lng, cells.n, true, now() from cells
  on conflict (key) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng, n_bars = excluded.n_bars,
                                  active = true, updated_at = excluded.updated_at;
  update public.olnu_heat_towns h set active = false, updated_at = now()
   where h.active and h.updated_at < now();
  select count(*) into v_n from public.olnu_heat_towns where active;
  return v_n;
end $$;

-- Where one beer event's heat may go: bar (rule a) and town (rule b). Both null = no heat.
create or replace function public.olnu_heat_place(p_lat double precision, p_lng double precision, p_precise boolean,
                                                  p_hkind smallint, p_hlat double precision, p_hlng double precision, p_bid bigint)
returns table(blat double precision, blng double precision, tlat double precision, tlng double precision)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_bla float8; v_bln float8; v_tla float8; v_tln float8; v_cos float8;
begin
  if p_lat is null or p_lng is null then
    return query select null::float8, null::float8, null::float8, null::float8;
    return;
  end if;
  v_cos := greatest(cos(radians(p_lat)), 0.1);
  if p_hkind = 1 and p_hlat is not null then
    v_bla := p_hlat; v_bln := p_hlng;
  elsif coalesce(p_precise, false) then
    select bl.lat, bl.lng into v_bla, v_bln from public.bars_lite bl
     where bl.active and coalesce(bl.type, '') in ('bar', 'pub', 'nightclub', 'biergarten', 'arena')
       and bl.lat between p_lat - 0.001 and p_lat + 0.001
       and bl.lng between p_lng - 0.001 / v_cos and p_lng + 0.001 / v_cos
       and public.olnu_heat_m(p_lat, p_lng, bl.lat, bl.lng) <= 100
     order by public.olnu_heat_m(p_lat, p_lng, bl.lat, bl.lng), bl.id
     limit 1;
  end if;
  if v_bla is null and p_bid is not null then
    select c.lat, c.lng into v_bla, v_bln
      from public.beers b join public.checkins c on c.user_id = b.user_id
     where b.id = p_bid and c.expires_at > now()
       and public.olnu_heat_m(p_lat, p_lng, c.lat, c.lng) <= 1000
     limit 1;
  end if;
  select t.lat, t.lng into v_tla, v_tln from public.olnu_heat_towns t
   where t.active
     and t.lat between p_lat - 0.55 and p_lat + 0.55
     and t.lng between p_lng - 0.55 / v_cos and p_lng + 0.55 / v_cos
     and public.olnu_heat_m(p_lat, p_lng, t.lat, t.lng) <= 60000
   order by public.olnu_heat_m(p_lat, p_lng, t.lat, t.lng), t.key
   limit 1;
  return query select v_bla, v_bln, v_tla, v_tln;
end $$;

-- 3. Fill on insert. Live definitions of 2026-11-08 + the marked lines (heat0485).
create or replace function public.olnu_log_beer_event()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    insert into public.beer_events (kind, lat, lng, precise, n, expires_at, bid)   -- heat0485: bid
    values ('beer', new.lat, new.lng, coalesce(new.precise, false), new.beer_count, new.expires_at, new.id);
  end if;
  if coalesce(new.shot_count, 0) > v_old_shots then
    insert into public.beer_events (kind, lat, lng, precise, n, expires_at, bid)   -- heat0485: bid
    values ('shot', new.lat, new.lng, coalesce(new.precise, false), 0, new.expires_at, new.id);
  end if;
  return new;
end; $function$;

create or replace function public.olnu_event_cell_tg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  begin
    select c.hlat, c.hlng, c.hkind into new.hlat, new.hlng, new.hkind
      from public.olnu_heat_cell(new.lat, new.lng, new.precise) c;
  exception when others then
    new.hlat := (round(new.lat::numeric / 0.005) * 0.005)::float8;
    new.hlng := (round(new.lng::numeric / 0.01) * 0.01)::float8;
    new.hkind := 3;
  end;
  -- heat0485: bar / town place of this event (never blocks the beer)
  if new.kind = 'beer' then
    begin
      select p.blat, p.blng, p.tlat, p.tlng into new.blat, new.blng, new.tlat, new.tlng
        from public.olnu_heat_place(new.lat, new.lng, new.precise, new.hkind, new.hlat, new.hlng, new.bid) p;
    exception when others then
      new.blat := null; new.blng := null; new.tlat := null; new.tlng := null;
    end;
  end if;
  return new;
end; $function$;

create or replace function public.olnu_beer_town_tg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    select p.tlat, p.tlng into new.tlat, new.tlng
      from public.olnu_heat_place(new.lat, new.lng, false, null::smallint, null, null, null) p;
  exception when others then
    new.tlat := null; new.tlng := null;
  end;
  return new;
end $$;
-- after olnu_a_world_pos (BEFORE triggers run in name order), so the real world position is used
create or replace trigger olnu_beer_town before insert or update of lat, lng on public.beers
  for each row execute function public.olnu_beer_town_tg();

-- Recompute towns + the places of recent events (after bar data changes). Keeps a bar place that the new data does not find
-- (check-in bars, removed bars) until the event expires.
create or replace function public.olnu_heat_place_refresh()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  perform public.olnu_heat_towns_refresh();
  update public.beer_events e
     set (blat, blng, tlat, tlng) = (select coalesce(p.blat, e.blat), case when p.blat is not null then p.blng else e.blng end,
                                            p.tlat, p.tlng
                                       from public.olnu_heat_place(e.lat, e.lng, e.precise, e.hkind, e.hlat, e.hlng, e.bid) p)
   where e.kind = 'beer' and e.created_at > now() - interval '4 days';
  get diagnostics v_n = row_count;
  update public.beers b set tlat = x.tlat, tlng = x.tlng
    from (select b2.id, p.tlat, p.tlng
            from public.beers b2
           cross join lateral public.olnu_heat_place(b2.lat, b2.lng, false, null::smallint, null, null, null) p
           where b2.expires_at > now()) x
   where x.id = b.id and (b.tlat, b.tlng) is distinct from (x.tlat, x.tlng);
  return v_n;
end $$;

create or replace function public.olnu_resnap()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- heat0485: town centres + bar / town places of recent events follow the bar data
  begin
    perform public.olnu_heat_place_refresh();
  exception when others then
    raise warning 'olnu_heat_place_refresh: %', sqlerrm;
  end;
  return v_n;
end;
$function$;

-- 4. The heat rows one viewer may get. p_live: tonight (expires_at > now()); else yesterday's clouds (1-3 days old).
create or replace function public.olnu_heat_rows(p_viewer uuid, p_live boolean, p_min_lat double precision, p_min_lng double precision,
                                                 p_max_lat double precision, p_max_lng double precision)
returns table(lat double precision, lng double precision, n integer, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with ev0 as (   -- two branches so each one can use its index (expires_at for tonight, created_at for yesterday)
    select e.lat as rlat, e.lng as rlng, e.n, e.created_at, e.bid, e.blat, e.blng, e.tlat, e.tlng
      from public.beer_events e
     where p_live and e.kind = 'beer' and e.expires_at > now() and not e.undone
    union all
    select e.lat, e.lng, e.n, e.created_at, e.bid, e.blat, e.blng, e.tlat, e.tlng
      from public.beer_events e
     where not p_live and e.kind = 'beer' and e.created_at >= now() - interval '3 days' and e.created_at < now() - interval '1 day'
       and not e.undone
  ),
  ev as (
    select ev0.* from ev0
     where (ev0.blat is not null or ev0.tlat is not null)
       and (p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
            or (ev0.blat between p_min_lat and p_max_lat and ev0.blng between p_min_lng and p_max_lng)
            or (ev0.tlat between p_min_lat and p_max_lat and ev0.tlng between p_min_lng and p_max_lng))
       -- test zone (olnu_is_test_zone, 68.25-68.45 N): only test users; the lat check first keeps the call off most rows
       and (ev0.rlat < 68 or ev0.rlat > 69 or not public.olnu_is_test_zone(ev0.rlat, ev0.rlng)
            or (select coalesce(public.olnu_is_test_user(p_viewer), false)))
  ),
  kn as (   -- rule (c): people whose pin this viewer sees (me, group mates, accepted friends) - only for tonight's heat
    select p_viewer as uid where p_live and p_viewer is not null
    union
    select am.user_id from public.group_members cm join public.group_members am on am.group_id = cm.group_id
     where p_live and p_viewer is not null and cm.user_id = p_viewer
    union
    select case when f.a = p_viewer then f.b else f.a end from public.friendships f
     where p_live and p_viewer is not null and (f.a = p_viewer or f.b = p_viewer) and f.status = 'accepted'
  ),
  bl as (
    select k.blocked as uid from public.user_blocks k where p_viewer is not null and k.active and k.blocker = p_viewer
    union
    select k.blocker from public.user_blocks k where p_viewer is not null and k.active and k.blocked = p_viewer
  ),
  j as (
    select ev.blat, ev.blng, ev.tlat, ev.tlng, ev.n, ev.created_at, (vv.user_id is not null) as fo
      from ev
      left join public.beers b on b.id = ev.bid
      left join public.olnu_visibility vv on vv.user_id = b.user_id and vv.friends_only
     where (case when p_live
                 -- tonight: the pin is gone -> its heat is gone (stop_beer: "Jag är hemma", Spöke, hidden beer; beer row gone).
                 -- beer_count stays as it is; only the heat goes. Events without bid (before 0485) cannot be checked.
                 then ev.bid is null or (b.id is not null and not b.stopped and not b.ghost)
                 else not coalesce(b.ghost, false) end)
       and (b.user_id is null or (not exists (select 1 from kn where kn.uid = b.user_id)
                                  and not exists (select 1 from bl where bl.uid = b.user_id)))
  ),
  s as (
    select case when j.blat is not null and not j.fo then j.blat else j.tlat end as slat,
           case when j.blat is not null and not j.fo then j.blng else j.tlng end as slng,
           j.n, j.created_at
      from j
  )
  select s.slat, s.slng, s.n, s.created_at from s
   where s.slat is not null
     and (p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
          or (s.slat between p_min_lat and p_max_lat and s.slng between p_min_lng and p_max_lng));
$$;

-- 5. The heat RPCs: same names, arguments and answer shapes.
create or replace function public.olnu_heat(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_limit integer)
 returns table(lat double precision, lng double precision, w double precision)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
begin
  -- heat0485: bars + town centres only; the caller (auth.uid()) never gets heat for a pin he sees. Weights as before.
  return query
  select r.lat, r.lng, sum(case when r.n >= 10 then 3 when r.n >= 5 then 2 else 1 end)::float8 as sw
    from public.olnu_heat_rows(auth.uid(), true, p_min_lat, p_min_lng, p_max_lat, p_max_lng) r
   group by r.lat, r.lng
   order by sw desc, r.lat, r.lng
   limit greatest(1, least(coalesce(p_limit, 5000), 5000));
end;
$function$;

create or replace function public.ghost_points()
 returns table(lat double precision, lng double precision, w double precision)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := public.olnu_uid();
begin
  -- heat0485: yesterday's clouds at bars + town centres only
  return query
  select r.lat, r.lng, count(*)::float8 as cw
    from public.olnu_heat_rows(v_uid, false, null, null, null, null) r
   group by r.lat, r.lng
   order by cw desc
   limit 5000;
end;
$function$;

create or replace function public.ghost_points2()
 returns table(lat double precision, lng double precision, w double precision, age_h double precision)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := public.olnu_uid();
begin
  -- heat0485: yesterday's clouds at bars + town centres only
  return query
  select r.lat, r.lng, count(*)::float8 as cw,
         round(avg(extract(epoch from (now() - r.created_at)) / 3600.0)::numeric, 1)::float8 as cage
    from public.olnu_heat_rows(v_uid, false, null, null, null, null) r
   group by r.lat, r.lng
   order by cw desc
   limit 5000;
end;
$function$;

-- 6. Grants: the new objects are server-only. (heat_points, ghost_points, ghost_points2, olnu_heat keep their grants:
--    CREATE OR REPLACE does not change them.)
revoke all on table public.olnu_heat_towns from public;
revoke all on function public.olnu_heat_m(double precision, double precision, double precision, double precision) from public;
revoke all on function public.olnu_heat_towns_refresh() from public;
revoke all on function public.olnu_heat_place(double precision, double precision, boolean, smallint, double precision, double precision, bigint) from public;
revoke all on function public.olnu_heat_place_refresh() from public;
revoke all on function public.olnu_beer_town_tg() from public;
revoke all on function public.olnu_heat_rows(uuid, boolean, double precision, double precision, double precision, double precision) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.olnu_heat_towns from anon, authenticated';
    execute 'revoke all on function public.olnu_heat_m(double precision, double precision, double precision, double precision) from anon, authenticated';
    execute 'revoke all on function public.olnu_heat_towns_refresh() from anon, authenticated';
    execute 'revoke all on function public.olnu_heat_place(double precision, double precision, boolean, smallint, double precision, double precision, bigint) from anon, authenticated';
    execute 'revoke all on function public.olnu_heat_place_refresh() from anon, authenticated';
    execute 'revoke all on function public.olnu_beer_town_tg() from anon, authenticated';
    execute 'revoke all on function public.olnu_heat_rows(uuid, boolean, double precision, double precision, double precision, double precision) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.olnu_heat_towns to service_role';
    execute 'grant execute on function public.olnu_heat_towns_refresh() to service_role';
    execute 'grant execute on function public.olnu_heat_place_refresh() to service_role';
  end if;
end $g$;

-- 7. Data: link tonight's events to their beer row (only when exactly one row fits), then towns + places (events of the
--    last 4 days, tonight's beer rows).
with m as (
  select e.id as eid, min(b.id) as bid, count(distinct b.id) as c
    from public.beer_events e
    join public.beers b on b.expires_at = e.expires_at and b.lat = e.lat and b.lng = e.lng
   where e.bid is null and e.expires_at > now()
   group by e.id
)
update public.beer_events e set bid = m.bid from m where m.eid = e.id and m.c = 1 and e.bid is null;
with m as (
  select e.id as eid, min(b.id) as bid, count(distinct b.id) as c
    from public.beer_events e
    join public.beers b on b.expires_at = e.expires_at and b.prev_lat = e.lat and b.prev_lng = e.lng
   where e.bid is null and e.expires_at > now()
   group by e.id
)
update public.beer_events e set bid = m.bid from m where m.eid = e.id and m.c = 1 and e.bid is null;
with m as (   -- same transaction time as the beer (undo_beer uses this match too)
  select e.id as eid, min(b.id) as bid, count(distinct b.id) as c
    from public.beer_events e
    join public.beers b on b.expires_at = e.expires_at and e.created_at in (b.beer_at, b.prev_beer_at, b.created_at)
   where e.bid is null and e.expires_at > now()
   group by e.id
)
update public.beer_events e set bid = m.bid from m where m.eid = e.id and m.c = 1 and e.bid is null;
-- (events that still have no bid count as an unknown person's beer until they expire at 05:00: bar or town, never home)
select public.olnu_heat_place_refresh() as heat_events_placed;

do $s$ begin
  if to_regprocedure('public.olnu_strip_cr()') is not null then perform public.olnu_strip_cr(); end if;
end $s$;

select 'ok heat0485' as result, (select count(*) from public.olnu_heat_towns where active) as towns;
