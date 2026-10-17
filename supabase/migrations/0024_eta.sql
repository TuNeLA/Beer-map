-- 0024 v18 ETA ("🏃 Jag é på väg"): a user picks 5/10/15/20/30 min to a bar or a call-out (rally).
-- Group-mates see "🏃 Anton · 7 min" in the bar popup and the rally sheet; mates who are already at
-- the place get a push (notify-group {event:"eta", eta_id}).
-- Additive only. Needs 0001-0011 (beers, groups, rallies, checkins) and olnu_dist_m / olnu_world_ok (0023).
-- Rows are never removed; every read filters on time. Safe to run again.

create table if not exists public.etas (
  id           bigserial primary key,
  user_id      uuid not null,
  group_id     uuid null,                 -- set for a rally ETA: only that group sees it
  bar_id       text null,
  bar_name     text null,
  lat          float8 null,
  lng          float8 null,
  rally_id     bigint null,
  minutes      int not null,
  created_at   timestamptz not null default now(),
  eta_at       timestamptz not null,
  expires_at   timestamptz not null,
  arrived_at   timestamptz null,
  cancelled_at timestamptz null,
  notified     boolean not null default false
);
alter table public.etas enable row level security;
create index if not exists etas_user_idx on public.etas (user_id, created_at desc);
create index if not exists etas_live_idx on public.etas (expires_at);
create index if not exists etas_rally_idx on public.etas (rally_id) where rally_id is not null;

-- One line, no control chars, trimmed, max n chars. Empty -> null.
create or replace function public.olnu_eta_clean(p text, n int)
returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), n), '');
$$;

-- A rally ETA ends with its rally (closed, or expired: 0025 caps rallies at 2 h).
create or replace function public.olnu_eta_rally_ok(e public.etas)
returns boolean language sql stable set search_path = public as $$
  select e.rally_id is null
      or exists (select 1 from public.rallies r where r.id = e.rally_id and not r.closed and r.expires_at > now());
$$;

-- "Live" ETA: tonight, not cancelled, not arrived, not more than 20 min past its time, rally still on.
create or replace function public.olnu_eta_live(e public.etas)
returns boolean language sql stable set search_path = public as $$
  select e.expires_at > now() and e.cancelled_at is null and e.arrived_at is null
     and e.eta_at > now() - interval '20 minutes' and public.olnu_eta_rally_ok(e);
$$;

-- Mark the user's live ETA as arrived when (bar id matches) or (place within 100 m).
create or replace function public.olnu_eta_arrive(p_uid uuid, p_bar_id text, p_lat float8, p_lng float8, p_bar_only boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.etas e set arrived_at = now()
   where e.user_id = p_uid and e.cancelled_at is null and e.arrived_at is null and e.expires_at > now()
     and e.eta_at > now() - interval '20 minutes'
     and (
       (p_bar_id is not null and e.bar_id is not null and e.bar_id = p_bar_id)
       or (
         (not p_bar_only or e.bar_id is null)
         and e.lat is not null and e.lng is not null and p_lat is not null and p_lng is not null
         and public.olnu_dist_m(e.lat, e.lng, p_lat, p_lng) <= 100
       )
     );
end; $$;

-- Check-in at that bar (or within 100 m of a rally place without a bar) -> arrived.
create or replace function public.olnu_eta_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' or new.created_at is distinct from old.created_at or new.bar_id is distinct from old.bar_id then
      perform public.olnu_eta_arrive(new.user_id, new.bar_id, new.lat, new.lng, true);
    end if;
  exception when others then
    null;   -- an ETA bug never blocks a check-in
  end;
  return new;
end; $$;
create or replace trigger olnu_eta_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_eta_checkin_tg();

-- A new drink with a precise, visible pin within 100 m of the target (or snapped to that bar) -> arrived.
create or replace function public.olnu_eta_beer_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if (tg_op = 'INSERT'
        or coalesce(new.beer_count, 0) > coalesce(old.beer_count, 0)
        or coalesce(new.other_count, 0) > coalesce(old.other_count, 0))
       and coalesce(new.precise, false) and not coalesce(new.stopped, false) and not coalesce(new.ghost, false) then
      perform public.olnu_eta_arrive(new.user_id, new.snap_bar, new.lat, new.lng, false);
    end if;
  exception when others then
    null;   -- an ETA bug never blocks a beer
  end;
  return new;
end; $$;
create or replace trigger olnu_eta_beers
  after insert or update on public.beers
  for each row execute function public.olnu_eta_beer_tg();

-- One ETA row as json for the caller.
create or replace function public.olnu_eta_json(e public.etas)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'bar_id', e.bar_id, 'bar_name', e.bar_name, 'lat', e.lat, 'lng', e.lng,
    'rally_id', e.rally_id, 'minutes', e.minutes, 'created_at', e.created_at, 'eta_at', e.eta_at,
    'expires_at', e.expires_at,
    'mins_left', greatest(0, ceil(extract(epoch from (e.eta_at - now())) / 60.0))::int,
    'arrived', e.arrived_at is not null, 'arrived_at', e.arrived_at,
    'active', public.olnu_eta_live(e));
$$;

-- set_eta(bar id, bar name, lat, lng, minutes, rally id?) -> jsonb {ok, wait_seconds, id, eta_at, minutes, ...}
-- Errors: invalid_minutes, invalid_bar, outside_sweden (= invalid coordinates), rally_not_found, not_member.
-- Max 1 new ETA per 2 min per user (ok=false + wait_seconds, nothing changes). A new ETA ends the old one.
create or replace function public.set_eta(p_bar_id text, p_bar_name text, p_lat float8, p_lng float8,
                                          p_minutes int, p_rally_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_bar   text := public.olnu_eta_clean(p_bar_id, 200);
  v_name  text := public.olnu_eta_clean(p_bar_name, 200);
  v_lat   float8; v_lng float8; v_group uuid := null;
  r       public.rallies;
  v_last  timestamptz;
  e       public.etas;
begin
  if p_minutes is null or p_minutes not in (5, 10, 15, 20, 30) then raise exception 'invalid_minutes'; end if;
  if p_rally_id is not null then
    select * into r from public.rallies x where x.id = p_rally_id and not x.closed and x.expires_at > now();
    if not found then raise exception 'rally_not_found'; end if;
    if not exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    v_group := r.group_id;
    if v_bar is not null and char_length(v_bar) > 80 then v_bar := null; end if;
    v_name := left(coalesce(v_name, public.olnu_eta_clean(r.place, 60)), 60);
    if public.olnu_world_ok(p_lat, p_lng) then
      v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
    elsif r.lat is not null and r.lng is not null then
      v_lat := r.lat; v_lng := r.lng;
    end if;
  else
    if v_bar is null or char_length(v_bar) > 80 or v_name is null or char_length(v_name) > 60 then
      raise exception 'invalid_bar';
    end if;
    if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
    v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_eta:' || v_uid::text, 0));
  select max(x.created_at) into v_last from public.etas x where x.user_id = v_uid;
  if v_last is not null and v_last > now() - interval '2 minutes' then
    select * into e from public.etas x where x.user_id = v_uid order by x.created_at desc limit 1;
    return public.olnu_eta_json(e) || jsonb_build_object('ok', false,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + interval '2 minutes' - now())))::int));
  end if;

  update public.etas x set cancelled_at = now()
   where x.user_id = v_uid and x.cancelled_at is null and x.arrived_at is null and x.expires_at > now();

  insert into public.etas (user_id, group_id, bar_id, bar_name, lat, lng, rally_id, minutes, eta_at, expires_at)
  values (v_uid, v_group, v_bar, v_name, v_lat, v_lng, p_rally_id, p_minutes,
          now() + make_interval(mins => p_minutes),
          case when p_rally_id is not null then least(public.olnu_next_expiry(), r.expires_at) else public.olnu_next_expiry() end)
  returning * into e;
  return public.olnu_eta_json(e) || jsonb_build_object('ok', true, 'wait_seconds', 0);
end; $$;

-- cancel_eta(p_arrived default false): ends the caller's live ETA ("Avbryt", or "Framme!" with p_arrived).
-- -> jsonb {ok, id, arrived} / {ok:false, reason:'no_eta'}
create or replace function public.cancel_eta(p_arrived boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint;
begin
  update public.etas x
     set cancelled_at = case when coalesce(p_arrived, false) then x.cancelled_at else now() end,
         arrived_at   = case when coalesce(p_arrived, false) then now() else x.arrived_at end
   where x.id = (select y.id from public.etas y
                  where y.user_id = v_uid and y.cancelled_at is null and y.arrived_at is null and y.expires_at > now()
                  order by y.created_at desc limit 1)
  returning x.id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'no_eta'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'arrived', coalesce(p_arrived, false));
end; $$;

-- my_eta() -> jsonb: the caller's newest ETA tonight that is live or arrived < 15 min ago, else {active:false}.
create or replace function public.my_eta()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  e public.etas;
begin
  select * into e from public.etas x
   where x.user_id = v_uid and x.expires_at > now() and x.cancelled_at is null
     and (public.olnu_eta_live(x) or (x.arrived_at > now() - interval '15 minutes' and public.olnu_eta_rally_ok(x)))
   order by x.created_at desc limit 1;
  if not found then return jsonb_build_object('active', false); end if;
  return public.olnu_eta_json(e);
end; $$;

-- group_etas(): ETAs of the caller and of users who share a group with the caller.
-- A rally ETA (group_id set) is seen only by members of that group. Live rows plus rows that arrived
-- in the last 15 min ("framme!"). name = display name in the shared group (own: smallest own name).
create or replace function public.group_etas()
returns table (id bigint, name text, is_me boolean, bar_id text, bar_name text, lat float8, lng float8,
               rally_id bigint, minutes int, eta_at timestamptz, mins_left int, created_at timestamptz,
               arrived boolean, arrived_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with mine as (select m.group_id, m.display_name from public.group_members m where m.user_id = v_uid)
  select e.id,
         case
           when e.user_id = v_uid then (select min(x.display_name) from mine x)
           when e.group_id is not null then (select gm.display_name from public.group_members gm
                                              where gm.group_id = e.group_id and gm.user_id = e.user_id)
           else (select min(gm.display_name) from public.group_members gm
                  where gm.user_id = e.user_id and gm.group_id in (select x.group_id from mine x))
         end::text,
         e.user_id = v_uid, e.bar_id, e.bar_name, e.lat, e.lng, e.rally_id, e.minutes, e.eta_at,
         greatest(0, ceil(extract(epoch from (e.eta_at - now())) / 60.0))::int, e.created_at,
         e.arrived_at is not null, e.arrived_at
    from public.etas e
   where e.expires_at > now() and e.cancelled_at is null
     and (public.olnu_eta_live(e) or (e.arrived_at > now() - interval '15 minutes' and public.olnu_eta_rally_ok(e)))
     and (
       e.user_id = v_uid
       or (e.group_id is null and exists (
             select 1 from public.group_members gm
              where gm.user_id = e.user_id and gm.group_id in (select x.group_id from mine x)))
       or (e.group_id is not null
           and e.group_id in (select x.group_id from mine x)
           and exists (select 1 from public.group_members gm where gm.group_id = e.group_id and gm.user_id = e.user_id))
     )
   order by e.eta_at
   limit 300;
end; $$;

revoke all on function public.olnu_eta_clean(text, int) from public;
revoke all on function public.olnu_eta_live(public.etas) from public;
revoke all on function public.olnu_eta_rally_ok(public.etas) from public;
revoke all on function public.olnu_eta_arrive(uuid, text, float8, float8, boolean) from public;
revoke all on function public.olnu_eta_checkin_tg() from public;
revoke all on function public.olnu_eta_beer_tg() from public;
revoke all on function public.olnu_eta_json(public.etas) from public;
revoke all on function public.set_eta(text, text, float8, float8, int, bigint) from public;
revoke all on function public.cancel_eta(boolean) from public;
revoke all on function public.my_eta() from public;
revoke all on function public.group_etas() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_eta_clean(text, int), public.olnu_eta_live(public.etas), '
         || 'public.olnu_eta_rally_ok(public.etas), public.olnu_eta_arrive(uuid, text, float8, float8, boolean), public.olnu_eta_checkin_tg(), '
         || 'public.olnu_eta_beer_tg(), public.olnu_eta_json(public.etas), '
         || 'public.set_eta(text, text, float8, float8, int, bigint), public.cancel_eta(boolean), '
         || 'public.my_eta(), public.group_etas() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_eta_clean(text, int), public.olnu_eta_live(public.etas), '
         || 'public.olnu_eta_rally_ok(public.etas), public.olnu_eta_arrive(uuid, text, float8, float8, boolean), public.olnu_eta_checkin_tg(), '
         || 'public.olnu_eta_beer_tg(), public.olnu_eta_json(public.etas) from authenticated';
    execute 'grant execute on function public.set_eta(text, text, float8, float8, int, bigint), '
         || 'public.cancel_eta(boolean), public.my_eta(), public.group_etas() to authenticated';
  end if;
end $$;
