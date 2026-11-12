-- 0506 · ride pickup label privacy (lane b0ride, I-30, 12 Nov 2026). OWNER-RUN. Needs 0495 (ride v3). Staging first.
-- Bug: the owner was AT HOME, 300 m from a bar, and the driver saw "Nära Taste Of India" (also in the push). The app made the
-- pickup label from the GPS ("nära <bar>"). Rule now: a place NAME shows only if the rider CHOSE it (a bar they picked, an address
-- they searched) or is checked in there. Otherwise only the area ("Hämtning i Ludvika C"). The exact point goes to the driver only
-- after the take (olnu_ride_json already does that: pk_lat / pk_lng only for the rider and the taker).
--   1. pickup_reqs.pk_chosen boolean (default false) + pk_area text. Old rows and old apps: pk_chosen = false → the old text
--      in pk_place (maybe "nära X") is NEVER shown; offer / arrived pushes say "Hämtning" (+ the area when the app sent it).
--   2. ride_request3 = ride_request2 + p_pk_chosen + p_pk_area (the app sends the name only when chosen).
--   3. olnu_ride_json: 'place' only when chosen, new 'area'. ride_push_claim: "Från <name>" / "Hämtning i <area>" / "Hämtning";
--      the arrived push to the rider has "Vid <name>" only when chosen.
-- Additive: add column if not exists, create or replace function, grants. No row or object is removed. Safe to run twice.
-- Deploy order: this file first (or together with the app); the notify-group function change is a second safety net only.
-- Check after the run (expect t, t, t): select exists (select 1 from information_schema.columns where table_name = 'pickup_reqs' and column_name = 'pk_chosen'),
--   to_regprocedure('public.ride_request3(double precision,double precision,text,integer,text,text,double precision,double precision,text,text,text,boolean,text)') is not null,
--   position('pk_chosen' in pg_get_functiondef('public.ride_push_claim(uuid,bigint)'::regprocedure)) > 0;

alter table public.pickup_reqs add column if not exists pk_chosen boolean not null default false;
alter table public.pickup_reqs add column if not exists pk_area text;

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
    'end_reason', r.end_reason, 'step_at', r.step_at, 'pax', r.pax, 'note', r.note,
    'place', case when r.pk_chosen then r.pk_place end, 'area', r.pk_area,
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

create or replace function public.ride_push_claim(p_uid uuid, p_req bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.pickup_reqs; v_jobs jsonb := '[]'::jsonb; u uuid; v_name text; v_drv text; v_dist int; v_car text; v_eta int;
  v_tag text; v_url text; v_place text; v_from text; v_n int; v_trip int;
begin
  select * into r from public.pickup_reqs x where x.id = p_req and x.v2;
  if not found then return v_jobs; end if;
  if p_uid is null or not (p_uid = r.user_id or p_uid = r.taken_by or p_uid = any (r.to_users) or p_uid = any (r.excluded)) then return v_jobs; end if;
  update public.pickup_reqs set notified = true where id = r.id and not notified;
  v_tag := 'olnu-pickup-' || r.id; v_url := '/?pickup=' || r.id;
  v_name := public.olnu_ride_name(r.user_id);
  -- I-30: a place NAME only if the rider chose it (a bar, a searched address) or is checked in there; else only the area.
  v_place := case when r.pk_chosen then nullif(r.pk_place, '') end;
  v_from := case when v_place is not null then 'från ' || v_place
                 when nullif(r.pk_area, '') is not null then 'hämtning i ' || r.pk_area else 'hämtning' end;
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
        'body', case when v_n > 0 then 'Igen: ' || v_from else upper(left(v_from, 1)) || substr(v_from, 2) end
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
          'body', concat_ws(' · ', case when v_place is not null then 'Vid ' || v_place end, v_car, 'Kolla att det ä rätt bil'), 'url', v_url, 'tag', v_tag, 'requireInteraction', true);
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

create or replace function public.ride_request3(p_lat double precision, p_lng double precision, p_place text default null,
  p_pax int default 1, p_note text default null, p_name text default null,
  p_dest_lat double precision default null, p_dest_lng double precision default null, p_dest_name text default null,
  p_dest_area text default null, p_dest_kind text default null, p_pk_chosen boolean default false, p_pk_area text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v jsonb; r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v := public.ride_request2(p_lat, p_lng, case when coalesce(p_pk_chosen, false) then p_place end, p_pax, p_note, p_name,
                            p_dest_lat, p_dest_lng, p_dest_name, p_dest_area, p_dest_kind);
  update public.pickup_reqs x set
         pk_chosen = coalesce(p_pk_chosen, false) and nullif(x.pk_place, '') is not null,
         pk_area = public.olnu_inv_clean(p_pk_area, 50)
   where x.id = (v ->> 'id')::bigint and x.user_id = v_uid
  returning * into r;
  if not found then return v; end if;
  return public.olnu_ride_json(r, v_uid);
end; $$;

do $$
declare
  v_int text := 'public.olnu_ride_json(public.pickup_reqs, uuid)';
  v_user text := 'public.ride_request3(double precision, double precision, text, integer, text, text, double precision, double precision, text, text, text, boolean, text)';
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

select public.olnu_strip_cr();
