-- 0420 PintsNow — RIDE v2 (lane ride, F1, 2026-11-10). OWNER-RUN at release. ADDITIVE ONLY: new columns, new tables,
-- new functions, one new trigger. No old function, table rule or policy is changed. Needs 0250 (pickup_reqs, driver_status),
-- 0080 (olnu_inv_cands, olnu_inv_clean), 0165 (drink_log), user_blocks (olnu_ub_hidden).
-- Everything is behind ride_flags.ride_v2 (default OFF). Steps 5–6 extras behind ride_flags.ride_v2_more (default OFF).
--   Turn on:      update public.ride_flags set on_ = true, updated_at = now() where key in ('ride_v2', 'ride_v2_more');
--   Kill switch:  update public.ride_flags set on_ = false, updated_at = now() where key = 'ride_v2';
-- Flow ("Hämta mig", like Uber, for friends):
--   ride_request → a v2 row in pickup_reqs (kind 'skjuts', lat/lng NULL so old clients never see a pin; the exact pickup point
--   is in pk_lat/pk_lng and goes ONLY to the taker). Receivers = all friends + all group mates (olnu_inv_cands) who said
--   "Jag kör ikväll", minus anyone who drank tonight (drink_log since 05:00 or a live pin with drinks), minus ghost drivers,
--   minus blocked. FIRST ACCEPT WINS: ride_take is one atomic UPDATE (… where status = 'open' and taken_by is null).
--   Live: the taker's position (ride_pos) goes ONLY to the requester and ONLY while taken / enroute / arrived; it is set to
--   NULL at every end (done, cancel, redispatch, auto-close 90 min after the take).
--   Pushes: notify-group {event:"pickup", req_id, ride:1} → ride_push_claim(uid, req) (service_role) returns each due push
--   once (ride_push_log). Tag olnu-pickup-<id> = class "safe" (outside the night budget).
-- Status: open → taken → enroute → arrived → done; open → expired (20 min); live → cancelled (rider);
--         taken/enroute/arrived → open (taker cancels or drinks: redispatch to the others).
-- Old clients: the row looks like a "🚗 Skjuts?" ask. An old-client driver who answers "Jag kommer" takes the ride by the
-- same atomic rule (trigger on pickup_answers); "Kan int'" = decline.
-- Account erase: the new tables hold user ids without foreign keys (so the erase never fails); the X4 erase function should
-- also sweep ride_msgs, ride_push_log and ride_awards (request to the misc lane, owner-run).

-- ---------- flags ----------
create table if not exists public.ride_flags (
  key        text primary key,
  on_        boolean not null default false,
  note       text,
  updated_at timestamptz not null default now()
);
alter table public.ride_flags enable row level security;
revoke all on table public.ride_flags from public, anon, authenticated;
insert into public.ride_flags (key, on_, note) values
  ('ride_v2',      false, 'Ride v2: Hämta mig to all drivers, first accept wins, live driver card (F1 steps 1-4 + cancel)'),
  ('ride_v2_more', false, 'Ride v2 extras: Fråga igen / Fråga fler, taxi card, Tack + Kvällens chaufför (F1 steps 5-6)')
on conflict (key) do nothing;

create or replace function public.olnu_ride_flag(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.on_ from public.ride_flags f where f.key = p_key), false);
$$;

create or replace function public.ride_flags_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(f.key, f.on_), '{}'::jsonb) from public.ride_flags f;
$$;

-- ---------- columns ----------
alter table public.pickup_reqs add column if not exists v2 boolean not null default false;
alter table public.pickup_reqs add column if not exists status text
  check (status is null or status in ('open', 'taken', 'enroute', 'arrived', 'done', 'cancelled', 'expired'));
alter table public.pickup_reqs add column if not exists taken_by uuid;
alter table public.pickup_reqs add column if not exists taken_at timestamptz;
alter table public.pickup_reqs add column if not exists opened_at timestamptz;
alter table public.pickup_reqs add column if not exists pax smallint;
alter table public.pickup_reqs add column if not exists note text;
alter table public.pickup_reqs add column if not exists pk_lat double precision;
alter table public.pickup_reqs add column if not exists pk_lng double precision;
alter table public.pickup_reqs add column if not exists pk_place text;
alter table public.pickup_reqs add column if not exists step_at jsonb not null default '{}'::jsonb;
alter table public.pickup_reqs add column if not exists declined uuid[] not null default '{}';
alter table public.pickup_reqs add column if not exists excluded uuid[] not null default '{}';
alter table public.pickup_reqs add column if not exists asked_wide boolean not null default false;
alter table public.pickup_reqs add column if not exists asked_again boolean not null default false;
alter table public.pickup_reqs add column if not exists round int not null default 1;
alter table public.pickup_reqs add column if not exists drv_lat double precision;
alter table public.pickup_reqs add column if not exists drv_lng double precision;
alter table public.pickup_reqs add column if not exists drv_at timestamptz;
alter table public.pickup_reqs add column if not exists drv_lat0 double precision;
alter table public.pickup_reqs add column if not exists drv_lng0 double precision;
alter table public.pickup_reqs add column if not exists thanks boolean not null default false;
create index if not exists pickup_reqs_v2_live_idx on public.pickup_reqs (status) where v2 and ended_at is null;
create index if not exists pickup_reqs_taken_idx on public.pickup_reqs (taken_by) where v2;

alter table public.driver_status add column if not exists car text;
alter table public.driver_status add column if not exists lat double precision;
alter table public.driver_status add column if not exists lng double precision;
alter table public.driver_status add column if not exists pos_at timestamptz;
alter table public.driver_status add column if not exists ghost boolean not null default false;

-- ---------- tables ----------
create table if not exists public.ride_msgs (
  id      bigserial primary key,
  req_id  bigint not null,
  user_id uuid not null,
  body    text not null check (char_length(body) between 1 and 120),
  at      timestamptz not null default now()
);
create index if not exists ride_msgs_req_idx on public.ride_msgs (req_id, id);
alter table public.ride_msgs enable row level security;
revoke all on table public.ride_msgs from public, anon, authenticated;

create table if not exists public.ride_push_log (
  req_id  bigint not null,
  user_id uuid not null,
  what    text not null,
  at      timestamptz not null default now(),
  primary key (req_id, user_id, what)
);
alter table public.ride_push_log enable row level security;
revoke all on table public.ride_push_log from public, anon, authenticated;

-- 🏅 Kvällens chaufför: finished rides per driver and night (the after lane can read it for the morning report)
create table if not exists public.ride_awards (
  user_id uuid not null,
  night   timestamptz not null,
  n       int not null default 0,
  thanks  int not null default 0,
  primary key (user_id, night)
);
alter table public.ride_awards enable row level security;
revoke all on table public.ride_awards from public, anon, authenticated;

-- ---------- helpers ----------
-- Drank tonight (since 05:00 Stockholm): any drink_log row that is not a check-in and not undone, or a live pin with drinks.
create or replace function public.olnu_ride_drinking(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    exists (select 1 from public.drink_log d where d.user_id = p_uid and d.kind <> 'checkin' and not d.undone
              and d.at >= public.olnu_night_of(now()) - interval '24 hours')
    or exists (select 1 from public.beers b where b.user_id = p_uid and b.expires_at > now()
              and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0));
$$;

-- Metres between two points (haversine).
create or replace function public.olnu_ride_dist(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns int language sql immutable set search_path = public as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null else
    round(2 * 6371000 * asin(least(1, sqrt(power(sin(radians(b_lat - a_lat) / 2), 2)
      + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))))::int end;
$$;

-- Who gets the offer. p_wide = every friend / group mate (Fråga fler), else only "Jag kör ikväll" drivers.
create or replace function public.olnu_ride_eligible(p_uid uuid, p_wide boolean default false)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x.uid), '{}'::uuid[]) from (
    select distinct c.uid
      from public.olnu_inv_cands(p_uid) c
      left join public.driver_status d on d.user_id = c.uid and d.night = public.olnu_night_of(now())
     where c.uid is not null and c.uid <> p_uid
       and (p_wide or d.user_id is not null)
       and not coalesce(d.ghost, false)
       and not public.olnu_ub_hidden(p_uid, c.uid)
       and not public.olnu_ride_drinking(c.uid)
     limit 60) x;
$$;

-- Timers + ends from the old paths (pickup_stop / replaced / timeout) + a taker who drank (redispatch).
create or replace function public.olnu_ride_sweep()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.pickup_reqs set status = 'expired', ended_at = now(), end_reason = 'expired'
   where v2 and status = 'open' and ended_at is null and coalesce(opened_at, created_at) < now() - interval '20 minutes';
  update public.pickup_reqs set status = 'done', ended_at = now(), end_reason = 'auto',
         drv_lat = null, drv_lng = null, drv_at = null, drv_lat0 = null, drv_lng0 = null,
         step_at = step_at || jsonb_build_object('done', now())
   where v2 and status in ('taken', 'enroute', 'arrived') and ended_at is null and taken_at < now() - interval '90 minutes';
  update public.pickup_reqs set
         status = case when end_reason = 'timeout' and status = 'open' then 'expired' when end_reason = 'timeout' then 'done' else 'cancelled' end,
         drv_lat = null, drv_lng = null, drv_at = null, drv_lat0 = null, drv_lng0 = null
   where v2 and ended_at is not null and status in ('open', 'taken', 'enroute', 'arrived');
  update public.pickup_reqs set status = 'open', excluded = excluded || taken_by, taken_by = null, taken_at = null,
         opened_at = now(), ends_at = now() + interval '20 minutes', round = round + 1,
         drv_lat = null, drv_lng = null, drv_at = null, drv_lat0 = null, drv_lng0 = null,
         step_at = step_at || jsonb_build_object('redispatch', now(), 'why', 'drank')
   where v2 and status in ('taken', 'enroute', 'arrived') and ended_at is null and public.olnu_ride_drinking(taken_by);
end; $$;

create or replace function public.olnu_ride_name(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(left(public.olnu_walk_name(p_uid, null), 30), ''), 'En kompis');
$$;

-- The ride as one viewer sees it. role: rider (my request) | taker (I drive it) | asked (an offer to me).
create or replace function public.olnu_ride_json(r public.pickup_reqs, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := case when p_viewer = r.user_id then 'rider' when p_viewer = r.taken_by then 'taker' else 'asked' end;
  v_live boolean := r.ended_at is null and r.status in ('open', 'taken', 'enroute', 'arrived');
  v_moving boolean := r.ended_at is null and r.status in ('taken', 'enroute', 'arrived');
  v jsonb; d public.driver_status; v_dist int; v_msgs jsonb;
begin
  v := jsonb_build_object('id', r.id, 'role', v_role, 'status', r.status, 'live', v_live,
    'created_at', r.created_at, 'opened_at', coalesce(r.opened_at, r.created_at), 'taken_at', r.taken_at, 'ended_at', r.ended_at,
    'end_reason', r.end_reason, 'step_at', r.step_at, 'pax', r.pax, 'note', r.note, 'place', r.pk_place,
    'n', coalesce(array_length(r.to_users, 1), 0), 'declined_n', coalesce(array_length(r.declined, 1), 0),
    'wide', r.asked_wide, 'again', r.asked_again, 'round', r.round, 'thanks', r.thanks,
    'taker_name', case when r.taken_by is not null then public.olnu_ride_name(r.taken_by) end);
  if v_role in ('rider', 'taker') then
    select coalesce(jsonb_agg(jsonb_build_object('me', m.user_id = p_viewer, 'body', m.body, 'at', m.at) order by m.id), '[]'::jsonb)
      into v_msgs from (select * from public.ride_msgs x where x.req_id = r.id order by x.id desc limit 30) m;
    v := v || jsonb_build_object('msgs', v_msgs);
  end if;
  if v_role = 'rider' and r.taken_by is not null then
    select * into d from public.driver_status s where s.user_id = r.taken_by;
    v_dist := case when v_moving then public.olnu_ride_dist(r.drv_lat, r.drv_lng, r.pk_lat, r.pk_lng) end;
    v := v || jsonb_build_object('driver', jsonb_build_object(
      'name', public.olnu_ride_name(r.taken_by), 'car', d.car,
      'avatar', (select a.spec from public.avatars a where a.user_id = r.taken_by),
      'lat', case when v_moving then r.drv_lat end, 'lng', case when v_moving then r.drv_lng end,
      'pos_at', case when v_moving then r.drv_at end, 'dist_m', v_dist,
      'eta_min', case when v_dist is not null then greatest(1, ceil(v_dist / 500.0))::int end));   -- 30 km/h = 500 m/min
  end if;
  if v_role = 'taker' then
    v := v || jsonb_build_object('rider', jsonb_build_object('name', public.olnu_ride_name(r.user_id),
      'avatar', (select a.spec from public.avatars a where a.user_id = r.user_id)),
      'pk_lat', case when v_live then r.pk_lat end, 'pk_lng', case when v_live then r.pk_lng end,
      'dist_m', case when v_moving then public.olnu_ride_dist(r.drv_lat, r.drv_lng, r.pk_lat, r.pk_lng) end);
  end if;
  if v_role = 'asked' then
    select * into d from public.driver_status s where s.user_id = p_viewer and s.pos_at > now() - interval '30 minutes';
    v := v || jsonb_build_object('name', public.olnu_ride_name(r.user_id),
      'dist_m', public.olnu_ride_dist(d.lat, d.lng, r.pk_lat, r.pk_lng),
      'my_declined', p_viewer = any (r.declined), 'excluded', p_viewer = any (r.excluded),
      'can_take', v_live and r.status = 'open' and not (p_viewer = any (r.excluded)));
  end if;
  return v;
end; $$;

-- ---------- poll ----------
-- Superset of pickup_poll (the old fields, without v2 rows) + ride. The driver's app sends its position (kept rounded to
-- ~100 m, only for the "1,2 km" in offers) and its ghost switch, only while "Jag kör ikväll" is on.
create or replace function public.ride_poll(p_lat double precision default null, p_lng double precision default null, p_ghost boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_base jsonb; v_in jsonb; v_mine jsonb; v_offers jsonb; v_drive jsonb; d public.driver_status;
  v_night timestamptz := public.olnu_night_of(now()); v_on boolean := public.olnu_ride_flag('ride_v2');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_on then
    perform public.olnu_pickup_sweep();
    perform public.olnu_ride_sweep();
    update public.driver_status s set
           lat = case when public.olnu_pickup_okpos(p_lat, p_lng) then round(p_lat::numeric, 3)::float8 else s.lat end,
           lng = case when public.olnu_pickup_okpos(p_lat, p_lng) then round(p_lng::numeric, 3)::float8 else s.lng end,
           pos_at = case when public.olnu_pickup_okpos(p_lat, p_lng) then now() else s.pos_at end,
           ghost = coalesce(p_ghost, s.ghost)
     where s.user_id = v_uid and s.night = v_night;
  end if;
  v_base := public.pickup_poll();
  if not v_on then return v_base || jsonb_build_object('ride', jsonb_build_object('v', 1, 'on', false)); end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_in from jsonb_array_elements(coalesce(v_base -> 'incoming', '[]'::jsonb)) e
   where not exists (select 1 from public.pickup_reqs x where x.id = (e ->> 'id')::bigint and x.v2);
  v_base := jsonb_set(v_base, '{incoming}', v_in);
  if v_base -> 'mine' is not null and jsonb_typeof(v_base -> 'mine') = 'object'
     and exists (select 1 from public.pickup_reqs x where x.id = (v_base -> 'mine' ->> 'id')::bigint and x.v2) then
    v_base := jsonb_set(v_base, '{mine}', 'null'::jsonb);
  end if;
  select public.olnu_ride_json(x, v_uid) into v_mine from public.pickup_reqs x
   where x.v2 and x.user_id = v_uid and (x.ended_at is null or x.ended_at > now() - interval '15 minutes')
   order by x.created_at desc limit 1;
  select public.olnu_ride_json(x, v_uid) into v_drive from public.pickup_reqs x
   where x.v2 and x.taken_by = v_uid and (x.ended_at is null or x.ended_at > now() - interval '15 minutes')
   order by x.taken_at desc limit 1;
  select coalesce(jsonb_agg(public.olnu_ride_json(x, v_uid) order by x.created_at desc), '[]'::jsonb) into v_offers
    from (select * from public.pickup_reqs x
           where x.v2 and v_uid = any (x.to_users) and x.user_id <> v_uid and x.taken_by is distinct from v_uid
             and not public.olnu_ub_hidden(v_uid, x.user_id)
             and (x.ended_at is null or x.ended_at > now() - interval '15 minutes')
           order by x.created_at desc limit 5) x;
  select * into d from public.driver_status s where s.user_id = v_uid;
  return v_base || jsonb_build_object('ride', jsonb_build_object('v', 1, 'on', true, 'more', public.olnu_ride_flag('ride_v2_more'),
    'now', now(), 'mine', v_mine, 'drive', v_drive, 'offers', v_offers,
    'drinking', public.olnu_ride_drinking(v_uid), 'car', d.car,
    'chauffeur', coalesce((select a.n from public.ride_awards a where a.user_id = v_uid and a.night = v_night), 0)));
end; $$;

-- ---------- request ----------
create or replace function public.ride_request(p_lat double precision, p_lng double precision, p_place text default null,
  p_pax int default 1, p_note text default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_to uuid[]; r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_ride_flag('ride_v2') then raise exception 'ride_off'; end if;
  if not public.olnu_pickup_okpos(p_lat, p_lng) then raise exception 'no_position'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  perform pg_advisory_xact_lock(hashtextextended('olnu-pickup:' || v_uid::text, 0));
  if exists (select 1 from public.pickup_reqs x where x.user_id = v_uid and x.created_at > now() - interval '60 seconds')
     or (select count(*) from public.pickup_reqs x where x.user_id = v_uid and x.created_at > now() - interval '12 hours') >= 6 then
    raise exception 'slow_down';
  end if;
  perform public.olnu_pickup_sweep();
  perform public.olnu_ride_sweep();
  update public.pickup_reqs set ended_at = now(), end_reason = 'replaced', lat = null, lng = null, acc = null,
         status = case when v2 then 'cancelled' else status end, drv_lat = null, drv_lng = null, drv_at = null
   where user_id = v_uid and ended_at is null;
  v_to := public.olnu_ride_eligible(v_uid, false);
  if coalesce(array_length(v_to, 1), 0) > 30 then v_to := v_to[1:30]; end if;
  insert into public.pickup_reqs (user_id, kind, to_users, v2, status, opened_at, ends_at, pax, note, pk_lat, pk_lng, pk_place, step_at)
  values (v_uid, 'skjuts', v_to, true, 'open', now(), now() + interval '20 minutes',
          greatest(1, least(8, coalesce(p_pax, 1))), public.olnu_inv_clean(p_note, 60),
          round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8, public.olnu_inv_clean(p_place, 60),
          jsonb_build_object('open', now()))
  returning * into r;
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- ---------- take (FIRST ACCEPT WINS) ----------
create or replace function public.ride_take(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_ride_sweep();
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and v_uid = any (x.to_users) and x.user_id <> v_uid;
  if not found or public.olnu_ub_hidden(v_uid, r.user_id) then raise exception 'not_found'; end if;
  if public.olnu_ride_drinking(v_uid) then return jsonb_build_object('ok', false, 'code', 'drinking'); end if;
  if v_uid = any (r.excluded) then return jsonb_build_object('ok', false, 'code', 'excluded'); end if;
  update public.pickup_reqs x set status = 'taken', taken_by = v_uid, taken_at = now(), ends_at = now() + interval '90 minutes',
         step_at = x.step_at || jsonb_build_object('taken', now()), declined = array_remove(x.declined, v_uid)
   where x.id = p_id and x.status = 'open' and x.taken_by is null and x.ended_at is null
  returning * into r;
  if found then return jsonb_build_object('ok', true, 'ride', public.olnu_ride_json(r, v_uid)); end if;
  select * into r from public.pickup_reqs x where x.id = p_id;
  if r.taken_by is not null and r.status in ('taken', 'enroute', 'arrived', 'done') then
    return jsonb_build_object('ok', false, 'code', 'taken', 'name', public.olnu_ride_name(r.taken_by), 'mine', r.taken_by = v_uid);
  end if;
  return jsonb_build_object('ok', false, 'code', 'ended');
end; $$;

create or replace function public.ride_decline(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.pickup_reqs x set declined = case when v_uid = any (x.declined) then x.declined else x.declined || v_uid end
   where x.id = p_id and x.v2 and v_uid = any (x.to_users) and x.user_id <> v_uid
  returning * into r;
  if not found then raise exception 'not_found'; end if;
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- ---------- steps ----------
create or replace function public.ride_step(p_id bigint, p_step text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_step text := lower(coalesce(p_step, ''));
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_step not in ('enroute', 'arrived', 'done') then raise exception 'invalid_step'; end if;
  perform public.olnu_ride_sweep();
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and (x.taken_by = v_uid or x.user_id = v_uid);
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status not in ('taken', 'enroute', 'arrived') then raise exception 'ended'; end if;
  if v_step <> 'done' and r.taken_by is distinct from v_uid then raise exception 'not_taker'; end if;
  if v_step = 'enroute' and r.status <> 'taken' then return public.olnu_ride_json(r, v_uid); end if;
  if v_step = 'arrived' and r.status = 'arrived' then return public.olnu_ride_json(r, v_uid); end if;
  if v_step = 'done' then
    update public.pickup_reqs x set status = 'done', ended_at = now(), end_reason = 'done',
           drv_lat = null, drv_lng = null, drv_at = null, drv_lat0 = null, drv_lng0 = null,
           step_at = x.step_at || jsonb_build_object('done', now())
     where x.id = p_id and x.status in ('taken', 'enroute', 'arrived') and x.ended_at is null
    returning * into r;
    if found then
      insert into public.ride_awards (user_id, night, n) values (r.taken_by, public.olnu_night_of(now()), 1)
      on conflict (user_id, night) do update set n = public.ride_awards.n + 1;
    end if;
  else
    update public.pickup_reqs x set status = v_step, step_at = x.step_at || jsonb_build_object(v_step, now())
     where x.id = p_id and x.status in ('taken', 'enroute', 'arrived') and x.ended_at is null
    returning * into r;
  end if;
  select * into r from public.pickup_reqs x where x.id = p_id;
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- Rider: cancel (terminal). Taker: back out → redispatch to the others (the taker is never asked again for this ride).
create or replace function public.ride_cancel(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and (x.user_id = v_uid or x.taken_by = v_uid);
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status not in ('open', 'taken', 'enroute', 'arrived') then return public.olnu_ride_json(r, v_uid); end if;
  if r.user_id = v_uid then
    update public.pickup_reqs x set status = 'cancelled', ended_at = now(), end_reason = 'cancel',
           drv_lat = null, drv_lng = null, drv_at = null, drv_lat0 = null, drv_lng0 = null,
           step_at = x.step_at || jsonb_build_object('cancelled', now())
     where x.id = p_id returning * into r;
  else
    update public.pickup_reqs x set status = 'open', excluded = x.excluded || v_uid, taken_by = null, taken_at = null,
           opened_at = now(), ends_at = now() + interval '20 minutes', round = x.round + 1,
           drv_lat = null, drv_lng = null, drv_at = null, drv_lat0 = null, drv_lng0 = null,
           step_at = x.step_at || jsonb_build_object('redispatch', now(), 'why', 'backed_out')
     where x.id = p_id and x.taken_by = v_uid returning * into r;
  end if;
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- ---------- steps 5–6 extras (flag ride_v2_more) ----------
create or replace function public.ride_widen(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_add uuid[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_ride_flag('ride_v2_more') then raise exception 'ride_off'; end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and x.user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status <> 'open' then raise exception 'ended'; end if;
  if r.asked_wide then return public.olnu_ride_json(r, v_uid) || jsonb_build_object('added', 0); end if;
  select coalesce(array_agg(u), '{}'::uuid[]) into v_add from unnest(public.olnu_ride_eligible(v_uid, true)) u
   where not (u = any (r.to_users)) and not (u = any (r.excluded));
  update public.pickup_reqs x set to_users = (x.to_users || v_add)[1:60], asked_wide = true,
         step_at = x.step_at || jsonb_build_object('wide', now())
   where x.id = p_id returning * into r;
  return public.olnu_ride_json(r, v_uid) || jsonb_build_object('added', coalesce(array_length(v_add, 1), 0));
end; $$;

create or replace function public.ride_again(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_add uuid[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_ride_flag('ride_v2_more') then raise exception 'ride_off'; end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and x.user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status <> 'open' then raise exception 'ended'; end if;
  if r.asked_again then return public.olnu_ride_json(r, v_uid); end if;
  if coalesce(r.opened_at, r.created_at) > now() - interval '4 minutes' then raise exception 'slow_down'; end if;
  select coalesce(array_agg(u), '{}'::uuid[]) into v_add from unnest(public.olnu_ride_eligible(v_uid, false)) u
   where not (u = any (r.to_users)) and not (u = any (r.excluded));
  update public.pickup_reqs x set to_users = (x.to_users || v_add)[1:60], asked_again = true, round = x.round + 1,
         step_at = x.step_at || jsonb_build_object('again', now())
   where x.id = p_id returning * into r;
  return public.olnu_ride_json(r, v_uid);
end; $$;

create or replace function public.ride_thanks(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.pickup_reqs x set thanks = true where x.id = p_id and x.v2 and x.user_id = v_uid and x.status = 'done' and not x.thanks
  returning * into r;
  if found and r.taken_by is not null then
    update public.ride_awards a set thanks = a.thanks + 1 where a.user_id = r.taken_by and a.night = public.olnu_night_of(r.ended_at);
  end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and x.user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- ---------- live position (taker → rider only) ----------
create or replace function public.ride_pos(p_id bigint, p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_st text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_pickup_okpos(p_lat, p_lng) then raise exception 'invalid_position'; end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and x.taken_by = v_uid;
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status not in ('taken', 'enroute', 'arrived') then
    return jsonb_build_object('ok', true, 'live', false, 'status', r.status);
  end if;
  if r.drv_at is not null and r.drv_at > now() - interval '4 seconds' then
    return jsonb_build_object('ok', true, 'live', true, 'status', r.status);
  end if;
  v_st := r.status;
  if v_st = 'taken' and r.drv_lat0 is not null and public.olnu_ride_dist(r.drv_lat0, r.drv_lng0, p_lat, p_lng) > 150 then v_st := 'enroute'; end if;
  if v_st in ('taken', 'enroute') and public.olnu_ride_dist(p_lat, p_lng, r.pk_lat, r.pk_lng) <= 150 then v_st := 'arrived'; end if;
  update public.pickup_reqs x set drv_lat = round(p_lat::numeric, 5)::float8, drv_lng = round(p_lng::numeric, 5)::float8, drv_at = now(),
         drv_lat0 = coalesce(x.drv_lat0, round(p_lat::numeric, 5)::float8), drv_lng0 = coalesce(x.drv_lng0, round(p_lng::numeric, 5)::float8),
         status = v_st, step_at = case when v_st <> x.status then x.step_at || jsonb_build_object(v_st, now()) else x.step_at end
   where x.id = p_id and x.taken_by = v_uid and x.ended_at is null;
  return jsonb_build_object('ok', true, 'live', true, 'status', v_st);
end; $$;

-- ---------- 1-tap chat between the two ----------
create or replace function public.ride_msg(p_id bigint, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_t text := public.olnu_inv_clean(p_text, 120);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_t is null then raise exception 'empty'; end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and x.taken_by is not null and (x.user_id = v_uid or x.taken_by = v_uid);
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null and r.ended_at < now() - interval '15 minutes' then raise exception 'ended'; end if;
  if exists (select 1 from public.ride_msgs m where m.req_id = p_id and m.user_id = v_uid and m.at > now() - interval '1 second') then
    raise exception 'slow_down';
  end if;
  insert into public.ride_msgs (req_id, user_id, body) values (p_id, v_uid, v_t);
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- ---------- car note ("Röd Volvo V70 · ABC 123") ----------
create or replace function public.ride_car_set(p_car text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_car text := public.olnu_inv_clean(p_car, 30);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  insert into public.driver_status (user_id, night, updated_at, car) values (v_uid, public.olnu_night_of(now()) - interval '1 day', now(), v_car)
  on conflict (user_id) do update set car = excluded.car;
  return jsonb_build_object('ok', true, 'car', v_car);
end; $$;

-- ---------- pushes (service_role, notify-group) ----------
-- Every push that is due for this ride and not sent yet, once each. Safety class (tag olnu-pickup-<id>).
create or replace function public.ride_push_claim(p_uid uuid, p_req bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.pickup_reqs; v_jobs jsonb := '[]'::jsonb; u uuid; v_name text; v_drv text; v_dist int; v_car text; v_eta int;
  v_tag text; v_url text; v_place text; v_n int;
begin
  select * into r from public.pickup_reqs x where x.id = p_req and x.v2;
  if not found then return v_jobs; end if;
  if p_uid is null or not (p_uid = r.user_id or p_uid = r.taken_by or p_uid = any (r.to_users) or p_uid = any (r.excluded)) then return v_jobs; end if;
  update public.pickup_reqs set notified = true where id = r.id and not notified;
  v_tag := 'olnu-pickup-' || r.id; v_url := '/?pickup=' || r.id;
  v_name := public.olnu_ride_name(r.user_id);
  v_place := coalesce(r.pk_place, 'där hen ä');
  -- offers: max 2 per driver per ride (first + one reminder: Fråga igen / redispatch)
  if r.status = 'open' and r.ended_at is null then
    foreach u in array r.to_users loop
      continue when u = r.user_id or u = any (r.declined) or u = any (r.excluded)
        or public.olnu_ub_hidden(u, r.user_id) or public.olnu_ride_drinking(u);
      select count(*) into v_n from public.ride_push_log l where l.req_id = r.id and l.user_id = u and l.what like 'offer%';
      continue when v_n >= 2;
      insert into public.ride_push_log (req_id, user_id, what) values (r.id, u, 'offer' || r.round) on conflict do nothing;
      continue when not found;
      v_dist := null;
      select public.olnu_ride_dist(s.lat, s.lng, r.pk_lat, r.pk_lng) into v_dist from public.driver_status s
       where s.user_id = u and s.pos_at > now() - interval '30 minutes';
      v_jobs := v_jobs || jsonb_build_object('to', u, 'title', v_name || ' behöver skjuts',
        'body', case when v_n > 0 then 'Igen: från ' else 'Från ' end || v_place || ' · ' || coalesce(r.pax, 1) || ' pers'
                || case when v_dist is not null then ' · ' || replace(to_char(round(v_dist / 1000.0, 1), 'FM990.0'), '.', ',') || ' km' else '' end
                || case when r.note is not null then ' · ' || r.note else '' end,
        'url', v_url, 'tag', v_tag, 'requireInteraction', true,
        'actions', jsonb_build_array(jsonb_build_object('action', 'ta', 'title', 'Jag tar den', 'url', v_url || '&ride=ta'),
                                     jsonb_build_object('action', 'nej', 'title', 'Kan int''', 'url', v_url || '&ride=nej')));
    end loop;
    -- the rider: a taker backed out (or drank) → "Vi frågar de andra"
    if r.round > 1 and coalesce(array_length(r.excluded, 1), 0) > 0 then
      insert into public.ride_push_log (req_id, user_id, what) values (r.id, r.user_id, 'redispatch' || r.round) on conflict do nothing;
      if found then
        v_jobs := v_jobs || jsonb_build_object('to', r.user_id, 'title', public.olnu_ride_name(r.excluded[array_length(r.excluded, 1)]) || ' kunde int'' köra',
          'body', 'Vi frågar de andra. Tryck för att se läget.', 'url', v_url, 'tag', v_tag);
      end if;
    end if;
  end if;
  if r.taken_by is not null and r.status in ('taken', 'enroute', 'arrived') and r.ended_at is null then
    v_drv := public.olnu_ride_name(r.taken_by);
    insert into public.ride_push_log (req_id, user_id, what) values (r.id, r.user_id, 'taken:' || r.taken_by) on conflict do nothing;
    if found then
      v_car := null; v_dist := null;
      select s.car, public.olnu_ride_dist(coalesce(r.drv_lat, s.lat), coalesce(r.drv_lng, s.lng), r.pk_lat, r.pk_lng) into v_car, v_dist
        from public.driver_status s where s.user_id = r.taken_by;
      v_eta := case when v_dist is not null then greatest(1, ceil(v_dist / 500.0))::int end;
      v_jobs := v_jobs || jsonb_build_object('to', r.user_id, 'title', v_drv || ' tar dig!',
        'body', concat_ws(' · ', v_car, case when v_eta is not null then 'ca ' || v_eta || ' min' end, 'Tryck för att följa bilen'),
        'url', v_url, 'tag', v_tag);
    end if;
    if r.status = 'arrived' then
      insert into public.ride_push_log (req_id, user_id, what) values (r.id, r.user_id, 'arrived:' || r.taken_by) on conflict do nothing;
      if found then
        select s.car into v_car from public.driver_status s where s.user_id = r.taken_by;
        v_jobs := v_jobs || jsonb_build_object('to', r.user_id, 'title', v_drv || ' ä framme',
          'body', concat_ws(' · ', 'Vid ' || v_place, v_car, 'Kolla att det ä rätt bil'), 'url', v_url, 'tag', v_tag, 'requireInteraction', true);
      end if;
    end if;
  end if;
  -- the rider cancelled after a take → tell the taker (only the taker; open offers just close in the app)
  if r.status = 'cancelled' and r.taken_by is not null then
    insert into public.ride_push_log (req_id, user_id, what) values (r.id, r.taken_by, 'cancel') on conflict do nothing;
    if found then
      v_jobs := v_jobs || jsonb_build_object('to', r.taken_by, 'title', v_name || ' behöver int'' skjuts längre',
        'body', 'Du kan släppa den. Tack ändå!', 'url', v_url, 'tag', v_tag);
    end if;
  end if;
  return v_jobs;
end; $$;

-- ---------- old clients: "Jag kommer" on a v2 row = take (same atomic rule), "Kan int'" = decline ----------
create or replace function public.olnu_ride_answer_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.ans = 'kommer' then
      update public.pickup_reqs x set status = 'taken', taken_by = new.user_id, taken_at = now(), ends_at = now() + interval '90 minutes',
             step_at = x.step_at || jsonb_build_object('taken', now(), 'old_client', true)
       where x.id = new.req_id and x.v2 and x.status = 'open' and x.taken_by is null and x.ended_at is null
         and not (new.user_id = any (x.excluded)) and not public.olnu_ride_drinking(new.user_id);
    elsif new.ans = 'kan_inte' then
      update public.pickup_reqs x set declined = x.declined || new.user_id
       where x.id = new.req_id and x.v2 and not (new.user_id = any (x.declined));
    end if;
  exception when others then
    null;   -- an answer must never fail because of ride v2
  end;
  return new;
end; $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'olnu_ride_answer' and tgrelid = 'public.pickup_answers'::regclass) then
    create trigger olnu_ride_answer after insert or update of ans on public.pickup_answers
      for each row execute function public.olnu_ride_answer_tg();
  end if;
end $$;

-- ---------- grants ----------
do $$
declare
  v_int text := 'public.olnu_ride_flag(text), public.olnu_ride_drinking(uuid), public.olnu_ride_eligible(uuid, boolean), '
             || 'public.olnu_ride_sweep(), public.olnu_ride_name(uuid), public.olnu_ride_json(public.pickup_reqs, uuid), '
             || 'public.olnu_ride_answer_tg()';
  v_user text := 'public.ride_flags_get(), public.ride_poll(double precision, double precision, boolean), '
              || 'public.ride_request(double precision, double precision, text, integer, text, text), public.ride_take(bigint), '
              || 'public.ride_decline(bigint), public.ride_step(bigint, text), public.ride_cancel(bigint), public.ride_widen(bigint), '
              || 'public.ride_again(bigint), public.ride_thanks(bigint), public.ride_pos(bigint, double precision, double precision), '
              || 'public.ride_msg(bigint, text), public.ride_car_set(text)';
  v_svc text := 'public.ride_push_claim(uuid, bigint)';
begin
  execute 'revoke all on function ' || v_int || ', ' || v_user || ', ' || v_svc || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_int || ', ' || v_user || ', ' || v_svc || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_int || ', ' || v_svc || ' from authenticated';
    execute 'grant execute on function ' || v_user || ' to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ' || v_svc || ', public.ride_flags_get() to service_role';
  end if;
end $$;
