-- lane b0ride SQL test for migration 0506 (I-30: pickup label privacy). Run on STAGING (never live) as postgres, e.g. Supabase MCP execute_sql.
-- One DO block = one transaction, ends with an EXCEPTION on purpose: "RIDE0506 pass=<n> fail=<m> | ..." (rolls everything back).
-- Every check FAILS on a database without 0506 (ride_request3 / pk_chosen do not exist) and the "old app" checks (ride_request2 with
-- "nära X" in the place) FAIL on 0495 (the driver offer says "Från nära X").
do $$
declare
  R uuid := gen_random_uuid(); D1 uuid := gen_random_uuid();
  v_night timestamptz := public.olnu_night_of(now());
  j jsonb; v_id bigint; v_id2 bigint; pass int := 0; fail int := 0; msg text := ''; u uuid; t text;
begin
  foreach u in array array[R, D1] loop
    insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values (u, 'authenticated', 'authenticated', true, now(), now());
  end loop;
  insert into public.user_names (user_id, name) values (R, 'Lisa'), (D1, 'Oskar');
  insert into public.friendships (a, b, requester, status, via, accepted_at) values (least(R, D1), greatest(R, D1), R, 'accepted', 'code', now());
  insert into public.driver_status (user_id, night, updated_at, lat, lng, pos_at, ghost, car) values (D1, v_night, now(), 60.148, 15.190, now(), false, 'Röd Volvo V70');
  update public.ride_flags set on_ = true where key in ('ride_v2', 'ride_v2_more');

  -- 1. new app, GPS pickup, NOT chosen: the name is dropped, the area stays
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_request3(p_lat => 60.14997, p_lng => 15.18679, p_place => 'Taste Of India', p_pax => 2, p_name => 'Lisa', p_pk_chosen => false, p_pk_area => 'Ludvika C');
  perform set_config('role', 'none', true);
  v_id := (j ->> 'id')::bigint;
  if j ->> 'place' is null and j ->> 'area' = 'Ludvika C' and (select pk_place is null and not pk_chosen from public.pickup_reqs where id = v_id)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL1:' || j::text; end if;
  t := public.ride_push_claim(R, v_id)::text;
  if t like '%Hämtning i Ludvika C · 2 pers%' and t not like '%Taste%' and t not like '%nära%' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL2:' || t; end if;
  -- the driver's view before the take: no name, no exact point
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_poll(null, null, null);
  perform set_config('role', 'none', true);
  if j::text not like '%Taste%' and j::text like '%Ludvika C%' and j::text not like '%pk_lat%' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL3:' || j::text; end if;
  -- take → on the way → arrived: the rider push has no "Vid <name>"; the exact point is in the taker view only now
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.ride_take(v_id); perform public.ride_step(v_id, 'enroute'); j := public.ride_step(v_id, 'arrived');
  perform set_config('role', 'none', true);
  if j ->> 'place' is null and j ->> 'pk_lat' is not null then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL4:' || j::text; end if;
  t := public.ride_push_claim(R, v_id)::text;
  if t like '%ä framme%' and t not like '%Taste%' and t not like '%Vid %' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL5:' || t; end if;

  -- 2. a CHOSEN place (a bar the rider picked): its name shows, in the offer and in the arrived push
  update public.pickup_reqs set created_at = now() - interval '5 minutes' where user_id = R;   -- the 60 s slow-down guard
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_request3(p_lat => 60.14997, p_lng => 15.18679, p_place => 'Pitchers', p_pax => 1, p_name => 'Lisa', p_pk_chosen => true, p_pk_area => 'Ludvika C');
  perform set_config('role', 'none', true);
  v_id2 := (j ->> 'id')::bigint;
  t := public.ride_push_claim(R, v_id2)::text;
  if j ->> 'place' = 'Pitchers' and t like '%Från Pitchers · 1 pers%' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL6:' || j::text || t; end if;

  -- 3. an OLD app (ride_request2 with "nära Taste Of India"): never shown
  update public.pickup_reqs set created_at = now() - interval '5 minutes' where user_id = R;
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_request2(60.14997, 15.18679, 'nära Taste Of India', 1, null, 'Lisa');
  perform set_config('role', 'none', true);
  t := public.ride_push_claim(R, (j ->> 'id')::bigint)::text;
  if j ->> 'place' is null and t not like '%Taste%' and t like '%Hämtning%' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL7:' || j::text || t; end if;

  raise exception 'RIDE0506 pass=% fail=%|%', pass, fail, msg;
end $$;
