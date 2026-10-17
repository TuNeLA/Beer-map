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
