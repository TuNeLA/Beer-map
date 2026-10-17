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
