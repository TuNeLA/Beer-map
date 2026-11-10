-- lane ride (F1) SQL test for migration 0420. Run on STAGING (never live) as the postgres role, e.g. Supabase MCP execute_sql.
-- One DO block = one transaction. It makes 8 fresh anonymous test users, one group and friendships, turns the ride flags on,
-- runs the checks as those users (role authenticated + jwt sub) and ENDS WITH AN EXCEPTION on purpose:
-- "RIDE_SQL pass=<n> fail=<m> | …". The exception rolls everything back, so nothing stays in the database.
-- Each check FAILS on a database without 0420 (the functions do not exist: the block stops with "function … does not exist").
do $$
declare
  R uuid := gen_random_uuid();    -- Lisa, wants a ride
  D1 uuid := gen_random_uuid();   -- Oskar, friend, "Jag kör"
  D2 uuid := gen_random_uuid();   -- Nisse, group mate, "Jag kör"
  D3 uuid := gen_random_uuid();   -- Kalle, friend, "Jag kör" but pressed ÖL! tonight
  D4 uuid := gen_random_uuid();   -- Sara, friend, "Jag kör" but ghost
  D5 uuid := gen_random_uuid();   -- Ida, friend, NOT driving
  D6 uuid := gen_random_uuid();   -- Bo, friend, "Jag kör" but blocked by Lisa
  X  uuid := gen_random_uuid();   -- stranger, "Jag kör"
  G uuid := gen_random_uuid(); v_night timestamptz := public.olnu_night_of(now());
  j jsonb; j2 jsonb; v_id bigint; v_to uuid[]; pass int := 0; fail int := 0; msg text := ''; u uuid;
begin
  -- ---------- setup (postgres) ----------
  foreach u in array array[R, D1, D2, D3, D4, D5, D6, X] loop
    insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values (u, 'authenticated', 'authenticated', true, now(), now());
  end loop;
  insert into public.user_names (user_id, name) values (R, 'Lisa'), (D1, 'Oskar'), (D2, 'Nisse'), (D3, 'Kalle'), (D4, 'Sara'), (D5, 'Ida'), (D6, 'Bo'), (X, 'Främling');
  insert into public.groups (id, name, code, created_by) values (G, 'Ridetest', translate(upper(substr(md5(G::text), 1, 6)), '01', '23'), R);
  insert into public.group_members (group_id, user_id, display_name) values (G, R, 'Lisa'), (G, D2, 'Nisse');
  insert into public.friendships (a, b, requester, status, via, accepted_at)
    select least(R, f), greatest(R, f), R, 'accepted', 'code', now() from unnest(array[D1, D3, D4, D5, D6]) f;
  insert into public.driver_status (user_id, night, updated_at, lat, lng, pos_at, ghost, car)
    values (D1, v_night, now(), 60.148, 15.190, now(), false, 'Röd Volvo V70'), (D2, v_night, now(), 60.150, 15.187, now(), false, null),
           (D3, v_night, now(), null, null, null, false, null), (D4, v_night, now(), null, null, null, true, null),
           (D6, v_night, now(), null, null, null, false, null), (X, v_night, now(), null, null, null, false, null);
  insert into public.drink_log (user_id, night, kind) values (D3, v_night, 'beer');
  insert into public.user_blocks (blocker, blocked, active) values (R, D6, true);
  update public.ride_flags set on_ = true where key in ('ride_v2', 'ride_v2_more');

  -- ---------- 1. request: receivers = drivers among friends + group mates, minus drinker, ghost, blocked ----------
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_request(60.14997, 15.18679, 'Pitchers', 2, 'vid kebaben', 'Lisa');
  perform set_config('role', 'none', true);
  v_id := (j ->> 'id')::bigint;
  select to_users into v_to from public.pickup_reqs where id = v_id;
  if j ->> 'status' = 'open' and j ->> 'role' = 'rider' and (j ->> 'n')::int = 2 and D1 = any (v_to) and D2 = any (v_to)
     and not (D3 = any (v_to)) and not (D4 = any (v_to)) and not (D5 = any (v_to)) and not (D6 = any (v_to)) and not (X = any (v_to))
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL1:' || j::text; end if;
  -- old clients never see a pin: lat/lng NULL, the pickup point only in pk_*
  if (select lat is null and lng is null and pk_lat is not null and kind = 'skjuts' and v2 from public.pickup_reqs where id = v_id)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL1b'; end if;

  -- ---------- 2. push claim: one offer per driver, all facts in the text, safety tag; second claim = nothing ----------
  j := public.ride_push_claim(R, v_id);
  if jsonb_array_length(j) = 2 and j -> 0 ->> 'title' = 'Lisa behöver skjuts' and j::text like '%Från Pitchers · 2 pers%'
     and j::text like '%km%' and j -> 0 ->> 'tag' = 'olnu-pickup-' || v_id and jsonb_array_length(j -> 0 -> 'actions') = 2
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL2:' || j::text; end if;
  j := public.ride_push_claim(R, v_id);
  if jsonb_array_length(j) = 0 then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL2b:' || j::text; end if;
  -- a stranger cannot trigger pushes for this ride
  if jsonb_array_length(public.ride_push_claim(X, v_id)) = 0 then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL2c'; end if;

  -- ---------- offer as the driver sees it: no exact pin before the take ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_poll(60.148, 15.190, false);
  perform set_config('role', 'none', true);
  if (j -> 'ride' ->> 'on')::boolean and jsonb_array_length(j -> 'ride' -> 'offers') = 1 and j -> 'ride' -> 'offers' -> 0 ->> 'name' = 'Lisa'
     and (j -> 'ride' -> 'offers' -> 0 ->> 'can_take')::boolean and j -> 'ride' -> 'offers' -> 0 -> 'pk_lat' is null
     and not exists (select 1 from jsonb_array_elements(j -> 'incoming') e where (e ->> 'id')::bigint = v_id)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL2d:' || (j -> 'ride')::text; end if;

  -- ---------- drinker cannot take ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin j := public.ride_take(v_id); exception when others then j := jsonb_build_object('err', sqlerrm); end;
  perform set_config('role', 'none', true);
  if j ->> 'err' = 'not_found' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL3a:' || j::text; end if;

  -- ---------- 3. first accept wins (sequential here; the parallel race is in ride-sql-race.md / ride-pw.js) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_take(v_id);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j2 := public.ride_take(v_id);
  perform set_config('role', 'none', true);
  if (j ->> 'ok')::boolean and j -> 'ride' ->> 'role' = 'taker' and j -> 'ride' ->> 'status' = 'taken'
     and not (j2 ->> 'ok')::boolean and j2 ->> 'code' = 'taken' and j2 ->> 'name' = 'Oskar'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL3:' || j::text || ' / ' || j2::text; end if;
  -- the loser's poll: "Oskar tog den"
  perform set_config('role', 'authenticated', true);
  j2 := public.ride_poll(null, null, false);
  perform set_config('role', 'none', true);
  if j2 -> 'ride' -> 'offers' -> 0 ->> 'taker_name' = 'Oskar' and not (j2 -> 'ride' -> 'offers' -> 0 ->> 'can_take')::boolean
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL3b:' || (j2 -> 'ride')::text; end if;
  -- push: rider gets "Oskar tar dig!" once
  j := public.ride_push_claim(D1, v_id);
  if jsonb_array_length(j) = 1 and j -> 0 ->> 'to' = R::text and j -> 0 ->> 'title' = 'Oskar tar dig!' and j::text like '%Röd Volvo V70%'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL3c:' || j::text; end if;

  -- ---------- 4. live: taker position only to the rider; auto steps; chat ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_pos(v_id, 60.1400, 15.1900);   -- start, ~1.2 km away
  perform set_config('role', 'none', true);
  update public.pickup_reqs set drv_at = now() - interval '10 seconds' where id = v_id;
  perform set_config('role', 'authenticated', true);
  j := public.ride_pos(v_id, 60.1440, 15.1890);   -- moved > 150 m → enroute
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'enroute' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL4a:' || j::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_poll(null, null, null);
  perform public.ride_msg(v_id, 'Kommer ut nu');
  perform set_config('role', 'none', true);
  if j -> 'ride' -> 'mine' -> 'driver' ->> 'name' = 'Oskar' and (j -> 'ride' -> 'mine' -> 'driver' ->> 'lat') is not null
     and (j -> 'ride' -> 'mine' -> 'driver' ->> 'eta_min')::int >= 1 and j -> 'ride' -> 'mine' -> 'driver' ->> 'car' = 'Röd Volvo V70'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL4b:' || (j -> 'ride' -> 'mine')::text; end if;
  -- a third person never sees the driver position
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_poll(null, null, null);
  perform set_config('role', 'none', true);
  if (j -> 'ride')::text not like '%"driver"%' and (j -> 'ride')::text not like '%60.144%' and (j -> 'ride')::text not like '%"msgs"%'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL4c:' || (j -> 'ride')::text; end if;
  update public.pickup_reqs set drv_at = now() - interval '10 seconds' where id = v_id;
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_pos(v_id, 60.14990, 15.18690);   -- at the pickup → arrived
  j2 := public.ride_poll(null, null, null);
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'arrived' and j2 -> 'ride' -> 'drive' -> 'msgs' -> 0 ->> 'body' = 'Kommer ut nu'
     and (j2 -> 'ride' -> 'drive' ->> 'pk_lat')::float8 = 60.14997
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL4d:' || j::text || (j2 -> 'ride' -> 'drive')::text; end if;
  j := public.ride_push_claim(D1, v_id);
  if jsonb_array_length(j) = 1 and j -> 0 ->> 'title' = 'Oskar ä framme' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL4e:' || j::text; end if;

  -- ---------- 6. done: position cleared, award + thanks ----------
  perform set_config('role', 'authenticated', true);
  j := public.ride_step(v_id, 'done');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j2 := public.ride_thanks(v_id);
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'done' and (select drv_lat is null and drv_lng is null from public.pickup_reqs where id = v_id)
     and (j2 ->> 'thanks')::boolean and (select n = 1 and thanks = 1 from public.ride_awards where user_id = D1 and night = v_night)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL6a:' || j::text; end if;

  -- ---------- 6. redispatch: taker backs out → open again, taker excluded, re-offer to the rest + rider told ----------
  update public.pickup_reqs set created_at = now() - interval '2 minutes' where id = v_id;   -- rate limit
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_request(60.14997, 15.18679, 'Pitchers', 1, null, 'Lisa');
  perform set_config('role', 'none', true);
  v_id := (j ->> 'id')::bigint;
  perform public.ride_push_claim(R, v_id);
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_take(v_id);
  j := public.ride_cancel(v_id);
  j2 := public.ride_take(v_id);
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'open' and j2 ->> 'code' = 'excluded'
     and (select taken_by is null and D2 = any (excluded) and round = 2 from public.pickup_reqs where id = v_id)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL6b:' || j::text || j2::text; end if;
  j := public.ride_push_claim(D2, v_id);
  if j::text like '%Nisse kunde int'' köra%' and j::text like '%Igen: från Pitchers%' and j::text not like ('%"to": "' || D2::text || '"%')
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL6c:' || j::text; end if;

  -- ---------- 1+safety: a taker who drinks loses the ride (sweep → redispatch) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_take(v_id);
  perform set_config('role', 'none', true);
  insert into public.drink_log (user_id, night, kind) values (D1, v_night, 'beer');
  perform public.olnu_ride_sweep();
  if (j ->> 'ok')::boolean and (select status = 'open' and taken_by is null and D1 = any (excluded) from public.pickup_reqs where id = v_id)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL1c:' || j::text; end if;

  -- ---------- 5. widen: Fråga fler adds friends who do not drive (Ida), still not the drinkers / blocked ----------
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_widen(v_id);
  perform set_config('role', 'none', true);
  select to_users into v_to from public.pickup_reqs where id = v_id;
  if (j ->> 'wide')::boolean and D5 = any (v_to) and not (D3 = any (v_to)) and not (D6 = any (v_to))
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL5a:' || j::text; end if;

  -- ---------- 6. rider cancel ends it; an old-client "Jag kommer" on a v2 row takes it atomically ----------
  perform set_config('role', 'authenticated', true);
  j := public.ride_cancel(v_id);
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'cancelled' and (select ended_at is not null from public.pickup_reqs where id = v_id)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL6d:' || j::text; end if;
  update public.pickup_reqs set created_at = now() - interval '2 minutes' where user_id = R;
  perform set_config('role', 'authenticated', true);
  j := public.ride_request(60.14997, 15.18679, null, 1, null, 'Lisa');
  perform set_config('role', 'none', true);
  v_id := (j ->> 'id')::bigint;
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.pickup_answer(v_id, 'kommer');
  perform set_config('role', 'none', true);
  if (select status = 'taken' and taken_by = D2 from public.pickup_reqs where id = v_id)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL6e'; end if;

  -- ---------- flag off: ride_request refuses, ride_poll = the old shape + ride.on false ----------
  update public.ride_flags set on_ = false where key = 'ride_v2';
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin j := public.ride_request(60.1, 15.1, null, 1, null, null); exception when others then j := jsonb_build_object('err', sqlerrm); end;
  j2 := public.ride_poll(null, null, null);
  perform set_config('role', 'none', true);
  if j ->> 'err' = 'ride_off' and not (j2 -> 'ride' ->> 'on')::boolean and j2 ? 'incoming' and j2 ? 'driving'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAILoff:' || j::text; end if;

  raise exception 'RIDE_SQL pass=% fail=%|%', pass, fail, msg;
end $$;
