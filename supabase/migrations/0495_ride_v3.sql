-- 0495 PintsNow — RIDE v3 (lane ride3, 11 Nov 2026; owner test 20:44 + live ride 7). OWNER-RUN, AFTER 0420 + 0453 and
-- 0430 / 0431 (and 0436). ADDITIVE: new columns, new functions, CREATE OR REPLACE of 0420 functions with the SAME
-- signatures (same grants). No statement removes rows or objects. Safe to run twice. A Windows paste (CR LF) is fine:
-- no multi-line text anchors here (full CREATE OR REPLACE), and the last block runs olnu_strip_cr() (0436) when it exists.
-- What changes:
--   1. Destination (optional): pickup_reqs.dest_lat / dest_lng / dest_name / dest_area / dest_kind ('home' | 'place').
--      New ride_request2(… + destination) = ride_request (unchanged) + the destination, in one transaction.
--      Privacy: before the take a driver sees ONLY the area (e.g. "Marnäs, Ludvika") + the trip estimate; the exact point
--      and the name go to the taker only while the ride is live; the rider sees everything (it is hers).
--   2. Steps keep their order and the driver owns them: taken → enroute (På väg) → arrived (Jag är här) → picked
--      (rider "Jag sitter i bilen" or driver "Hen sitter i bilen"; step_at.picked, status stays 'arrived') → done (driver
--      Klar at the destination). The rider can never end the ride (live 21:10: rider "Jag sitter i bilen" = Klar). A
--      wrong order answers the row unchanged + code 'order' (no error).
--   3. ride_pos keeps the 0420 auto steps (owner 21:13: auto "Framme" at the pickup is fine) but never skips På väg in
--      the data: a jump taken → arrived also writes step_at.enroute, so both phones show På väg ✓ + Framme. Throttle
--      4 s → 2 s (the app sends every 4 s while live).
--   4. ride_stamp_get(): a small read-only answer that changes when anything in my rides changes. The app asks it every
--      2.5–5 s while a request is open or "Jag kör ikväll" is on, and only then runs the full ride_poll.
--   5. Offer push text has the destination area: "Från Pitchers → Marnäs · 2 pers · 1,2 km · resa ca 3,4 km".
--   6. "Ring?" (owner 21:16): NO phone number is shown by default. Either side of a live ride asks (ride_call_ask, max 2
--      per person per ride); the other side answers (ride_call_answer) Ja / Nej. Only after Ja does the asker get the
--      number, only while the ride is live and only between the current rider and taker. The number is the one typed in
--      the answer, else the saved Swish number (rnd_swish) — used ONLY with this explicit Ja. Never in ride_msgs.
--      public.ride_calls keeps the consent log (ride, who, when, answer); the number in it is set to NULL by a trigger when
--      the ride ends or the taker changes. Push "Rickard vill ringa dig" once per ask (ride_push_claim).
--   7. LÄSK! (owner 21:26): a "Jag kör ikväll" driver logs a soda with ride_lask_post → public.ride_lask, its OWN table.
--      It never touches beers / drink_log, so it never counts as alcohol anywhere (stats, medals, meriter, Du leder,
--      ticker, MEDEVAC, morning report, heat) and never blocks the driver (olnu_ride_drinking reads only drink_log / beers).
--      Max 1 per 60 s (slow_down). Returns tonight's count.
-- Undo: the 0420 file re-creates the old function bodies (CREATE OR REPLACE). The new columns stay (unused).

-- ---------- 1. columns ----------
alter table public.pickup_reqs add column if not exists dest_lat double precision;
alter table public.pickup_reqs add column if not exists dest_lng double precision;
alter table public.pickup_reqs add column if not exists dest_name text;
alter table public.pickup_reqs add column if not exists dest_area text;
alter table public.pickup_reqs add column if not exists dest_kind text check (dest_kind is null or dest_kind in ('home', 'place'));

-- consent log for "Ring?" (no foreign keys, like 0420's ride tables, so an account erase never fails)
create table if not exists public.ride_calls (
  id          bigserial primary key,
  req_id      bigint not null,
  from_uid    uuid not null,
  to_uid      uuid not null,
  asked_at    timestamptz not null default now(),
  answer      text check (answer is null or answer in ('yes', 'no')),
  answered_at timestamptz,
  phone       text
);
create index if not exists ride_calls_req_idx on public.ride_calls (req_id, id);
alter table public.ride_calls enable row level security;
revoke all on table public.ride_calls from public, anon, authenticated;

-- ---------- helpers ----------
-- Road estimate pickup → destination: straight line × 1.3. Minutes: 30 km/h in town (< 4 km), else 54 km/h.
create or replace function public.olnu_ride_trip_m(r public.pickup_reqs)
returns int language sql stable security definer set search_path = public as $$
  select case when r.dest_lat is null or r.pk_lat is null then null
    else round(1.3 * public.olnu_ride_dist(r.pk_lat, r.pk_lng, r.dest_lat, r.dest_lng))::int end;
$$;
create or replace function public.olnu_ride_mins(p_m int)
returns int language sql immutable set search_path = public as $$
  select case when p_m is null then null else greatest(1, ceil(p_m / case when p_m < 4000 then 500.0 else 900.0 end))::int end;
$$;
-- The destination as one viewer sees it (null when the rider gave none).
create or replace function public.olnu_ride_dest(r public.pickup_reqs, p_role text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_m int; v_live boolean := r.ended_at is null and r.status in ('open', 'taken', 'enroute', 'arrived');
begin
  if r.dest_lat is null and r.dest_area is null then return null; end if;
  v_m := public.olnu_ride_trip_m(r);
  if p_role = 'rider' then
    return jsonb_build_object('kind', r.dest_kind, 'name', r.dest_name, 'area', r.dest_area, 'lat', r.dest_lat, 'lng', r.dest_lng,
      'trip_m', v_m, 'trip_min', public.olnu_ride_mins(v_m));
  elsif p_role = 'taker' then
    return jsonb_build_object('kind', r.dest_kind, 'name', r.dest_name, 'area', r.dest_area,
      'lat', case when v_live then r.dest_lat end, 'lng', case when v_live then r.dest_lng end,
      'trip_m', v_m, 'trip_min', public.olnu_ride_mins(v_m));
  end if;
  return jsonb_build_object('kind', r.dest_kind, 'area', r.dest_area, 'trip_m', v_m, 'trip_min', public.olnu_ride_mins(v_m));
end; $$;

-- "Ring?" as one side of the ride sees it: my last ask (out), a pending ask to me (in), the other's number after Ja (tel).
create or replace function public.olnu_ride_call_json(r public.pickup_reqs, p_viewer uuid, p_live boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_other uuid := case when p_viewer = r.user_id then r.taken_by else r.user_id end; o public.ride_calls; i public.ride_calls; v_n int; v_tel text;
begin
  if v_other is null or r.taken_by is null then return null; end if;
  select * into o from public.ride_calls c where c.req_id = r.id and c.from_uid = p_viewer and c.to_uid = v_other order by c.id desc limit 1;
  select count(*) into v_n from public.ride_calls c where c.req_id = r.id and c.from_uid = p_viewer;
  select * into i from public.ride_calls c where c.req_id = r.id and c.from_uid = v_other and c.to_uid = p_viewer and c.answer is null
     and c.asked_at > now() - interval '10 minutes' order by c.id desc limit 1;
  if p_live then
    select c.phone into v_tel from public.ride_calls c where c.req_id = r.id and c.from_uid = p_viewer and c.to_uid = v_other
       and c.answer = 'yes' and c.phone is not null order by c.id desc limit 1;
  end if;
  return jsonb_build_object('n_out', v_n,
    'out', case when o.id is not null then jsonb_build_object('id', o.id, 'at', o.asked_at, 'answer', o.answer) end,
    'in', case when i.id is not null and p_live then jsonb_build_object('id', i.id, 'at', i.asked_at,
      'saved', exists (select 1 from public.rnd_swish s where s.user_id = p_viewer and s.number is not null)) end,
    'tel', v_tel);
end; $$;

-- ---------- the ride as one viewer sees it (0420 + dest, the rider's own pickup point, drv_min, msg ids) ----------
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
    'taker_name', case when r.taken_by is not null then public.olnu_ride_name(r.taken_by) end,
    'dest', public.olnu_ride_dest(r, v_role), 'v3', true);
  if v_role in ('rider', 'taker') then
    select coalesce(jsonb_agg(jsonb_build_object('me', m.user_id = p_viewer, 'body', m.body, 'at', m.at, 'id', m.id) order by m.id), '[]'::jsonb)
      into v_msgs from (select * from public.ride_msgs x where x.req_id = r.id order by x.id desc limit 30) m;
    v := v || jsonb_build_object('msgs', v_msgs, 'call', public.olnu_ride_call_json(r, p_viewer, v_live));
  end if;
  if v_role = 'rider' then
    v := v || jsonb_build_object('pk_lat', case when v_live then r.pk_lat end, 'pk_lng', case when v_live then r.pk_lng end);
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
    v_dist := case when v_moving then public.olnu_ride_dist(r.drv_lat, r.drv_lng, r.pk_lat, r.pk_lng) end;
    v := v || jsonb_build_object('rider', jsonb_build_object('name', public.olnu_ride_name(r.user_id),
      'avatar', (select a.spec from public.avatars a where a.user_id = r.user_id)),
      'pk_lat', case when v_live then r.pk_lat end, 'pk_lng', case when v_live then r.pk_lng end,
      'dist_m', v_dist);
  end if;
  if v_role = 'asked' then
    select * into d from public.driver_status s where s.user_id = p_viewer and s.pos_at > now() - interval '30 minutes';
    v_dist := public.olnu_ride_dist(d.lat, d.lng, r.pk_lat, r.pk_lng);
    v := v || jsonb_build_object('name', public.olnu_ride_name(r.user_id),
      'dist_m', v_dist, 'drv_min', case when v_dist is not null then greatest(1, ceil(v_dist / 500.0))::int end,
      'my_declined', p_viewer = any (r.declined), 'excluded', p_viewer = any (r.excluded),
      'can_take', v_live and r.status = 'open' and not (p_viewer = any (r.excluded)));
  end if;
  return v;
end; $$;

-- ---------- request with a destination ----------
create or replace function public.ride_request2(p_lat double precision, p_lng double precision, p_place text default null,
  p_pax int default 1, p_note text default null, p_name text default null,
  p_dest_lat double precision default null, p_dest_lng double precision default null, p_dest_name text default null,
  p_dest_area text default null, p_dest_kind text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v jsonb; r public.pickup_reqs; v_ok boolean := public.olnu_pickup_okpos(p_dest_lat, p_dest_lng);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v := public.ride_request(p_lat, p_lng, p_place, p_pax, p_note, p_name);
  update public.pickup_reqs x set
         dest_lat = case when v_ok then round(p_dest_lat::numeric, 5)::float8 end,
         dest_lng = case when v_ok then round(p_dest_lng::numeric, 5)::float8 end,
         dest_name = case when v_ok then public.olnu_inv_clean(p_dest_name, 40) end,
         dest_area = case when v_ok then public.olnu_inv_clean(p_dest_area, 50) end,
         dest_kind = case when v_ok then (case when p_dest_kind = 'home' then 'home' else 'place' end) end
   where x.id = (v ->> 'id')::bigint and x.user_id = v_uid
  returning * into r;
  if not found then return v; end if;
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- ---------- steps in order (owned by the driver; the rider can only confirm "Jag sitter i bilen") ----------
-- taken → enroute (driver: På väg) → arrived (driver: Jag är här) → picked (rider: Jag sitter i bilen, or driver: Hen
-- sitter i bilen; kept in step_at.picked, the status stays 'arrived' — the 0420 status list has no new value) → done
-- (driver: Klar, at the destination). A rider 'done' (a 0420 app: "Jag sitter i bilen") = 'picked'. Wrong order =
-- the row unchanged + code 'order'.
create or replace function public.ride_step(p_id bigint, p_step text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_step text := lower(coalesce(p_step, '')); v_rider boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_step not in ('enroute', 'arrived', 'picked', 'done') then raise exception 'invalid_step'; end if;
  perform public.olnu_ride_sweep();
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and (x.taken_by = v_uid or x.user_id = v_uid);
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status not in ('taken', 'enroute', 'arrived') then raise exception 'ended'; end if;
  v_rider := r.taken_by is distinct from v_uid;
  if v_rider and v_step = 'done' then v_step := 'picked'; end if;
  if v_rider and v_step <> 'picked' then raise exception 'not_taker'; end if;
  if v_step = r.status or (v_step = 'picked' and r.step_at ? 'picked') then return public.olnu_ride_json(r, v_uid); end if;   -- a second tap
  if (v_step = 'enroute' and r.status <> 'taken') or (v_step = 'arrived' and r.status <> 'enroute')
     or (v_step = 'picked' and r.status <> 'arrived') or (v_step = 'done' and not (r.status = 'arrived' and r.step_at ? 'picked')) then
    return public.olnu_ride_json(r, v_uid) || jsonb_build_object('code', 'order');
  end if;
  if v_step = 'done' then
    update public.pickup_reqs x set status = 'done', ended_at = now(), end_reason = 'done',
           drv_lat = null, drv_lng = null, drv_at = null, drv_lat0 = null, drv_lng0 = null,
           step_at = x.step_at || jsonb_build_object('done', now())
     where x.id = p_id and x.status = 'arrived' and x.ended_at is null
    returning * into r;
    if found then
      insert into public.ride_awards (user_id, night, n) values (r.taken_by, public.olnu_night_of(now()), 1)
      on conflict (user_id, night) do update set n = public.ride_awards.n + 1;
    end if;
  elsif v_step = 'enroute' then
    update public.pickup_reqs x set status = 'enroute', step_at = x.step_at || jsonb_build_object('enroute', now())
     where x.id = p_id and x.status = 'taken' and x.ended_at is null;
  elsif v_step = 'arrived' then
    update public.pickup_reqs x set status = 'arrived', step_at = x.step_at || jsonb_build_object('arrived', now())
     where x.id = p_id and x.status = 'enroute' and x.ended_at is null;
  else
    update public.pickup_reqs x set step_at = x.step_at || jsonb_build_object('picked', now(), 'picked_by', case when v_rider then 'rider' else 'taker' end)
     where x.id = p_id and x.status = 'arrived' and x.ended_at is null;
  end if;
  select * into r from public.pickup_reqs x where x.id = p_id;
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- ---------- live position (0420 auto steps; a jump taken → arrived also marks På väg; throttle 2 s) ----------
create or replace function public.ride_pos(p_id bigint, p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_st text; v_add jsonb := '{}'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_pickup_okpos(p_lat, p_lng) then raise exception 'invalid_position'; end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and x.taken_by = v_uid;
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status not in ('taken', 'enroute', 'arrived') then
    return jsonb_build_object('ok', true, 'live', false, 'status', r.status);
  end if;
  if r.drv_at is not null and r.drv_at > now() - interval '2 seconds' then
    return jsonb_build_object('ok', true, 'live', true, 'status', r.status);
  end if;
  v_st := r.status;
  if v_st = 'taken' and r.drv_lat0 is not null and public.olnu_ride_dist(r.drv_lat0, r.drv_lng0, p_lat, p_lng) > 150 then v_st := 'enroute'; end if;
  if v_st in ('taken', 'enroute') and public.olnu_ride_dist(p_lat, p_lng, r.pk_lat, r.pk_lng) <= 150 then v_st := 'arrived'; end if;
  if v_st <> r.status then
    v_add := jsonb_build_object(v_st, now(), 'auto_' || v_st, true);
    if v_st = 'arrived' and not (r.step_at ? 'enroute') then v_add := v_add || jsonb_build_object('enroute', now(), 'auto_enroute', true); end if;
  end if;
  update public.pickup_reqs x set drv_lat = round(p_lat::numeric, 5)::float8, drv_lng = round(p_lng::numeric, 5)::float8, drv_at = now(),
         drv_lat0 = coalesce(x.drv_lat0, round(p_lat::numeric, 5)::float8), drv_lng0 = coalesce(x.drv_lng0, round(p_lng::numeric, 5)::float8),
         status = v_st, step_at = x.step_at || v_add
   where x.id = p_id and x.taken_by = v_uid and x.ended_at is null;
  return jsonb_build_object('ok', true, 'live', true, 'status', v_st);
end; $$;

-- ---------- the cheap "did anything change?" answer ----------
create or replace function public.ride_stamp_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_s text; v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_ride_flag('ride_v2') then return jsonb_build_object('on', false); end if;
  select md5(coalesce(string_agg(concat_ws(':', x.id, x.status, x.round, x.taken_by, x.ended_at is not null,
           coalesce(array_length(x.declined, 1), 0), coalesce(array_length(x.to_users, 1), 0), x.thanks, x.asked_wide,
           x.asked_again, x.dest_area, md5(x.step_at::text), case when x.user_id = v_uid then x.drv_at end,
           (select max(m.id) from public.ride_msgs m where m.req_id = x.id),
           (select max(c.id)::text || coalesce(max(c.answered_at)::text, '') from public.ride_calls c where c.req_id = x.id)), ',' order by x.id), '')), count(*)
    into v_s, v_n
    from public.pickup_reqs x
   where x.v2 and x.created_at > now() - interval '3 hours'
     and (x.user_id = v_uid or x.taken_by = v_uid or v_uid = any (x.to_users) or v_uid = any (x.excluded))
     and (x.ended_at is null or x.ended_at > now() - interval '15 minutes');
  return jsonb_build_object('on', true, 's', left(v_s, 16), 'n', v_n, 'now', now());
end; $$;

-- ---------- "Ring?" — ask / answer (consent) ----------
create or replace function public.ride_call_ask(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_other uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and x.taken_by is not null and (x.user_id = v_uid or x.taken_by = v_uid);
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status not in ('taken', 'enroute', 'arrived') then raise exception 'ended'; end if;
  v_other := case when v_uid = r.user_id then r.taken_by else r.user_id end;
  perform pg_advisory_xact_lock(hashtextextended('olnu-ride-call:' || p_id || ':' || v_uid::text, 0));
  if not exists (select 1 from public.ride_calls c where c.req_id = p_id and c.from_uid = v_uid and c.to_uid = v_other
                   and (c.answer = 'yes' or (c.answer is null and c.asked_at > now() - interval '10 minutes'))) then
    if (select count(*) from public.ride_calls c where c.req_id = p_id and c.from_uid = v_uid) >= 2 then raise exception 'slow_down'; end if;
    insert into public.ride_calls (req_id, from_uid, to_uid) values (p_id, v_uid, v_other);
  end if;
  return public.olnu_ride_json(r, v_uid);
end; $$;

create or replace function public.ride_call_answer(p_id bigint, p_yes boolean, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; c public.ride_calls; v_tel text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into r from public.pickup_reqs x where x.id = p_id and x.v2 and x.taken_by is not null and (x.user_id = v_uid or x.taken_by = v_uid);
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null or r.status not in ('taken', 'enroute', 'arrived') then raise exception 'ended'; end if;
  select * into c from public.ride_calls k where k.req_id = p_id and k.to_uid = v_uid and k.answer is null
     and k.from_uid = case when v_uid = r.user_id then r.taken_by else r.user_id end order by k.id desc limit 1;
  if not found then return public.olnu_ride_json(r, v_uid); end if;
  if coalesce(p_yes, false) then
    v_tel := nullif(public.olnu_rnd_swish_norm(p_phone), '');
    if v_tel is null and nullif(btrim(coalesce(p_phone, '')), '') is not null then raise exception 'invalid_phone'; end if;
    if v_tel is null then select s.number into v_tel from public.rnd_swish s where s.user_id = v_uid and s.number is not null; end if;
    if v_tel is null then raise exception 'no_phone'; end if;
    update public.ride_calls set answer = 'yes', answered_at = now(), phone = v_tel where id = c.id;
  else
    update public.ride_calls set answer = 'no', answered_at = now() where id = c.id;
  end if;
  return public.olnu_ride_json(r, v_uid);
end; $$;

-- the number never outlives the ride (or a taker change): set it to NULL, keep the consent row
create or replace function public.olnu_ride_call_end_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    update public.ride_calls set phone = null where req_id = new.id and phone is not null;
  exception when others then null;   -- a ride change must never fail because of this
  end;
  return new;
end; $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'olnu_ride_call_end' and tgrelid = 'public.pickup_reqs'::regclass) then
    create trigger olnu_ride_call_end after update of ended_at, taken_by on public.pickup_reqs
      for each row when ((new.ended_at is not null and old.ended_at is null) or new.taken_by is distinct from old.taken_by)
      execute function public.olnu_ride_call_end_tg();
  end if;
end $$;

-- ---------- pushes: 0420 + the destination area in the offer text ----------
create or replace function public.ride_push_claim(p_uid uuid, p_req bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.pickup_reqs; v_jobs jsonb := '[]'::jsonb; u uuid; v_name text; v_drv text; v_dist int; v_car text; v_eta int;
  v_tag text; v_url text; v_place text; v_n int; v_trip int;
begin
  select * into r from public.pickup_reqs x where x.id = p_req and x.v2;
  if not found then return v_jobs; end if;
  if p_uid is null or not (p_uid = r.user_id or p_uid = r.taken_by or p_uid = any (r.to_users) or p_uid = any (r.excluded)) then return v_jobs; end if;
  update public.pickup_reqs set notified = true where id = r.id and not notified;
  v_tag := 'olnu-pickup-' || r.id; v_url := '/?pickup=' || r.id;
  v_name := public.olnu_ride_name(r.user_id);
  v_place := coalesce(r.pk_place, 'där hen ä');
  v_trip := public.olnu_ride_trip_m(r);
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
        'body', case when v_n > 0 then 'Igen: från ' else 'Från ' end || v_place
                || case when r.dest_area is not null then ' → ' || r.dest_area else '' end
                || ' · ' || coalesce(r.pax, 1) || ' pers'
                || case when v_dist is not null then ' · ' || replace(to_char(round(v_dist / 1000.0, 1), 'FM990.0'), '.', ',') || ' km' else '' end
                || case when v_trip is not null then ' · resa ca ' || replace(to_char(round(v_trip / 1000.0, 1), 'FM990.0'), '.', ',') || ' km' else '' end
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
  -- "Ring?": one push per ask to the other side (no number in the push)
  if r.taken_by is not null and r.status in ('taken', 'enroute', 'arrived') and r.ended_at is null then
    for u, v_n in select c.to_uid, c.id from public.ride_calls c where c.req_id = r.id and c.answer is null and c.asked_at > now() - interval '10 minutes'
                    and c.to_uid in (r.user_id, r.taken_by) loop
      insert into public.ride_push_log (req_id, user_id, what) values (r.id, u, 'call:' || v_n) on conflict do nothing;
      if found then
        v_jobs := v_jobs || jsonb_build_object('to', u, 'title', public.olnu_ride_name(case when u = r.user_id then r.taken_by else r.user_id end) || ' vill ringa dig',
          'body', 'Visa ditt nummer? Tryck för att svara.', 'url', v_url, 'tag', v_tag, 'requireInteraction', true);
      end if;
    end loop;
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

-- ---------- LÄSK! for the driver: a soda, never a drink ----------
create table if not exists public.ride_lask (
  id      bigserial primary key,
  user_id uuid not null,
  night   timestamptz not null,
  at      timestamptz not null default now(),
  lat     double precision,
  lng     double precision
);
create index if not exists ride_lask_user_idx on public.ride_lask (user_id, at desc);
alter table public.ride_lask enable row level security;
revoke all on table public.ride_lask from public, anon, authenticated;

create or replace function public.ride_lask_post(p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(now()); v_ok boolean := public.olnu_pickup_okpos(p_lat, p_lng);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-lask:' || v_uid::text, 0));
  if exists (select 1 from public.ride_lask l where l.user_id = v_uid and l.at > now() - interval '60 seconds') then raise exception 'slow_down'; end if;
  insert into public.ride_lask (user_id, night, lat, lng)
  values (v_uid, v_night, case when v_ok then round(p_lat::numeric, 3)::float8 end, case when v_ok then round(p_lng::numeric, 3)::float8 end);
  return jsonb_build_object('ok', true, 'n', (select count(*) from public.ride_lask l where l.user_id = v_uid and l.night = v_night), 'at', now());
end; $$;

-- ---------- grants ----------
do $$
declare
  v_int text := 'public.olnu_ride_trip_m(public.pickup_reqs), public.olnu_ride_mins(integer), '
             || 'public.olnu_ride_dest(public.pickup_reqs, text), public.olnu_ride_json(public.pickup_reqs, uuid), '
             || 'public.olnu_ride_call_json(public.pickup_reqs, uuid, boolean), public.olnu_ride_call_end_tg()';
  v_user text := 'public.ride_request2(double precision, double precision, text, integer, text, text, double precision, double precision, text, text, text), '
              || 'public.ride_stamp_get(), public.ride_step(bigint, text), public.ride_pos(bigint, double precision, double precision), '
              || 'public.ride_call_ask(bigint), public.ride_call_answer(bigint, boolean, text), public.ride_lask_post(double precision, double precision)';
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
    execute 'grant execute on function ' || v_svc || ' to service_role';
  end if;
end $$;

-- ---------- Windows paste: take the CR characters out of the stored function text (0436) ----------
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'olnu_strip_cr') then
    perform public.olnu_strip_cr();
  end if;
end $$;
