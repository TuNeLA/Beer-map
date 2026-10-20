-- 0046 TRUPPEN SAMLAD. Client: docs/js/near.js (window.NEAR). Needs 0001–0035 (+ 0045).
-- Trigger: 3 or more members of one group within 50 m of one member (the "anchor") = a gathering.
-- 50 m, not 20 m: phone GPS in a town centre jitters 10–30 m (worse indoors), and a check-in sits on the bar
-- point while a pin sits where the phone was. At 20 m three people at the same table would often not match.
-- Positions = what the server already has, rounded as stored (5 decimals):
--   * a live check-in < 3 h → the bar point (bars_lite) else the stored check-in point,
--   * a live, visible, PRECISE pin with a drink in the last 2 h → the bar point when snapped (0015 snap_bar), else
--     the pin. "Bara område" pins (~550 m grid) and ghost pins never count.
--   Newest of the two per member; a member who said Hej då / Jag är hemma after it does not count.
-- Limit: max one gathering per group per place per 90 min (same bar, or within 150 m). A bigger crowd later
-- only raises n. Rows are never removed. Positions are never returned to clients: only bar name or town.
-- Safe to run again.

create table if not exists public.squad_gatherings (
  id         bigserial primary key,
  group_id   uuid not null,
  night      timestamptz not null,
  bar_id     text null,
  place_name text null,
  place_kind text not null default 'none' check (place_kind in ('bar', 'town', 'none')),
  lat        float8 null,
  lng        float8 null,
  n          int not null default 0,
  members    uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists squad_gatherings_group on public.squad_gatherings (group_id, created_at desc);
create table if not exists public.squad_checks (
  group_id uuid primary key,
  at       timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['squad_gatherings', 'squad_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on table public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on table public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table public.%I to service_role', t); end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_squad_pres(p_group uuid)
returns table (uid uuid, lat float8, lng float8, bar_id text, bar_name text, at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with m as (select gm.user_id from public.group_members gm where gm.group_id = p_group),
  raw as (
    select c.user_id as u, coalesce(bl.lat, c.lat) as la, coalesce(bl.lng, c.lng) as ln, c.bar_id as bid,
           coalesce(bl.name, c.bar_name) as bname, c.created_at as t
      from public.checkins c join m on m.user_id = c.user_id
      left join public.bars_lite bl on bl.id = c.bar_id
     where c.expires_at > now() and c.created_at > now() - interval '3 hours'
    union all
    select b.user_id, case when b.snap_bar is not null then coalesce(bl.lat, b.lat) else b.lat end,
           case when b.snap_bar is not null then coalesce(bl.lng, b.lng) else b.lng end,
           b.snap_bar, bl.name, greatest(b.beer_at, b.other_at, b.created_at)
      from public.beers b join m on m.user_id = b.user_id
      left join public.bars_lite bl on bl.id = b.snap_bar
     where b.expires_at > now() and not b.stopped and not coalesce(b.ghost, false) and b.precise
       and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)) >= 1
       and greatest(b.beer_at, b.other_at, b.created_at) > now() - interval '2 hours'
  ), pres as (
    select distinct on (r.u) r.* from raw r where r.la is not null and r.ln is not null order by r.u, r.t desc
  )
  select p.u, p.la, p.ln, p.bid, p.bname, p.t
    from pres p
   where not exists (select 1 from public.crew_byes y where y.user_id = p.u and y.night = v_night and y.cleared_at is null and y.at >= p.t)
     and not exists (select 1 from public.after_nights an where an.user_id = p.u and an.night = v_night and an.home_at >= p.t);
end; $$;

-- Look for a gathering in one group. Returns the id of a NEW gathering, else null (none, or the same place
-- within 90 min: then n / members grow). Checked at most every 20 s per group.
create or replace function public.olnu_squad_detect(p_group uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_last timestamptz; a record; v_members uuid[]; v_n int; v_bar text; v_bname text;
  v_lat float8; v_lng float8; v_town text; g public.squad_gatherings; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_squad:' || p_group::text, 0));
  select c.at into v_last from public.squad_checks c where c.group_id = p_group;
  if v_last is not null and v_last > now() - interval '20 seconds' then return null; end if;
  insert into public.squad_checks (group_id, at) values (p_group, now())
    on conflict (group_id) do update set at = now();

  -- Anchor = the member with most members within 50 m (self included); tie → the newest position.
  select p1.uid, p1.lat, p1.lng, p1.at, count(*)::int as n into a
    from public.olnu_squad_pres(p_group) p1
    join public.olnu_squad_pres(p_group) p2 on public.olnu_dist_m(p1.lat, p1.lng, p2.lat, p2.lng) <= 50
   group by p1.uid, p1.lat, p1.lng, p1.at
   order by count(*) desc, p1.at desc
   limit 1;
  if a.uid is null or a.n < 3 then return null; end if;

  select array_agg(p.uid order by p.at), count(*)::int, avg(p.lat), avg(p.lng)
    into v_members, v_n, v_lat, v_lng
    from public.olnu_squad_pres(p_group) p
   where public.olnu_dist_m(a.lat, a.lng, p.lat, p.lng) <= 50;
  select p.bar_id, max(p.bar_name) into v_bar, v_bname
    from public.olnu_squad_pres(p_group) p
   where public.olnu_dist_m(a.lat, a.lng, p.lat, p.lng) <= 50 and p.bar_id is not null
   group by p.bar_id order by count(*) desc, max(p.at) desc limit 1;
  v_lat := round(v_lat::numeric, 4)::float8; v_lng := round(v_lng::numeric, 4)::float8;
  if v_bar is null or v_bname is null then v_bar := null; v_town := public.olnu_town_of(v_lat, v_lng); end if;

  select * into g from public.squad_gatherings x
   where x.group_id = p_group and x.created_at > now() - interval '90 minutes'
     and ((v_bar is not null and x.bar_id = v_bar) or public.olnu_dist_m(x.lat, x.lng, v_lat, v_lng) <= 150)
   order by x.created_at desc limit 1;
  if g.id is not null then
    update public.squad_gatherings x
       set n = greatest(x.n, v_n),
           members = array(select distinct u from unnest(x.members || v_members) u),
           updated_at = now()
     where x.id = g.id;
    return null;
  end if;
  insert into public.squad_gatherings (group_id, night, bar_id, place_name, place_kind, lat, lng, n, members)
  values (p_group, public.olnu_night_of(now()), v_bar, coalesce(v_bname, v_town),
          case when v_bar is not null then 'bar' when v_town is not null then 'town' else 'none' end,
          v_lat, v_lng, v_n, v_members)
  returning id into v_id;
  return v_id;
end; $$;

-- One gathering as json for a viewer (names = current members only, in arrival order).
create or replace function public.olnu_squad_json(g public.squad_gatherings, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', g.id, 'group_id', g.group_id,
    'group_name', (select gr.name from public.groups gr where gr.id = g.group_id),
    'place', g.place_name, 'kind', g.place_kind, 'bar_id', g.bar_id, 'n', g.n,
    'names', coalesce((select jsonb_agg(gm.display_name order by array_position(g.members, gm.user_id))
                         from public.group_members gm where gm.group_id = g.group_id and gm.user_id = any(g.members)), '[]'::jsonb),
    'here', p_viewer = any(g.members), 'at', g.created_at, 'updated_at', g.updated_at);
$$;

-- "Nätter tillsammans": distinct nights with a gathering.
create or replace function public.olnu_squad_nights(p_group uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct x.night)::int from public.squad_gatherings x where x.group_id = p_group;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- squad_poll() -> jsonb {v, server_time, squads:[gathering json + nights]} : runs the check for each of the
-- caller's groups (max 20), then returns gatherings of the last 3 h, newest first.
create or replace function public.squad_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r record; v_out jsonb;
begin
  for r in select gm.group_id from public.group_members gm where gm.user_id = v_uid order by gm.joined_at limit 20 loop
    begin
      perform public.olnu_squad_detect(r.group_id);
    exception when others then null;
    end;
  end loop;
  select coalesce(jsonb_agg(public.olnu_squad_json(x, v_uid) || jsonb_build_object('nights', public.olnu_squad_nights(x.group_id))
                            order by x.created_at desc), '[]'::jsonb)
    into v_out
    from public.squad_gatherings x
   where x.created_at > now() - interval '3 hours'
     and x.group_id in (select gm.group_id from public.group_members gm where gm.user_id = v_uid);
  return jsonb_build_object('v', 1, 'server_time', now(), 'squads', v_out);
end; $$;

-- squad_group(p_group_id) -> jsonb {nights, total, best_n, last:[gathering json] (max 10)}. Errors: not_member.
create or replace function public.squad_group(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_last jsonb;
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select coalesce(jsonb_agg(public.olnu_squad_json(x, v_uid) order by x.created_at desc), '[]'::jsonb) into v_last
    from (select * from public.squad_gatherings y where y.group_id = p_group_id order by y.created_at desc limit 10) x;
  return jsonb_build_object('nights', public.olnu_squad_nights(p_group_id),
    'total', (select count(*) from public.squad_gatherings x where x.group_id = p_group_id),
    'best_n', (select coalesce(max(x.n), 0) from public.squad_gatherings x where x.group_id = p_group_id),
    'last', v_last);
end; $$;

-- ---------------------------------------------------------------------------
-- Grants: helpers nobody, RPCs authenticated only
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_squad_pres(uuid), public.olnu_squad_detect(uuid), '
    || 'public.olnu_squad_json(public.squad_gatherings, uuid), public.olnu_squad_nights(uuid)';
  v_rpcs text := 'public.squad_poll(), public.squad_group(uuid)';
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
