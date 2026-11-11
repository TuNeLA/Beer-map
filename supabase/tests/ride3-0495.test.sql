-- lane ride3 SQL test for migration 0495 (ride v3). Local Postgres copy or STAGING (never live), as the postgres role.
-- One DO block = one transaction. Fresh test users at 68.35 / 18.80; it ENDS WITH AN EXCEPTION on purpose
-- ("RIDE3_SQL pass=<n> fail=<m> | …"), so everything is rolled back and nothing stays in the database.
-- On a database without 0495 it stops at the first new function ("function … does not exist") = FAIL.
do $$
declare
  R uuid := gen_random_uuid();    -- Lisa, wants a ride home
  D1 uuid := gen_random_uuid();   -- Oskar, friend, "Jag kör" (same house as Lisa)
  D2 uuid := gen_random_uuid();   -- Nisse, friend, "Jag kör"
  X  uuid := gen_random_uuid();   -- stranger
  v_night timestamptz := public.olnu_night_of(now());
  j jsonb; o jsonb; s1 text; s2 text; v_id bigint; v_id2 bigint; pass int := 0; fail int := 0; msg text := ''; u uuid;
  PLAT float8 := 68.3500; PLNG float8 := 18.8000; HLAT float8 := 68.3620; HLNG float8 := 18.8400;
begin
  foreach u in array array[R, D1, D2, X] loop
    insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values (u, 'authenticated', 'authenticated', true, now(), now());
  end loop;
  insert into public.user_names (user_id, name) values (R, 'Lisa'), (D1, 'Oskar'), (D2, 'Nisse'), (X, 'Främling');
  insert into public.friendships (a, b, requester, status, via, accepted_at)
    select least(R, f), greatest(R, f), R, 'accepted', 'code', now() from unnest(array[D1, D2]) f;
  insert into public.driver_status (user_id, night, updated_at, lat, lng, pos_at, ghost, car)
    values (D1, v_night, now(), 68.350, 18.800, now(), false, 'Röd Volvo V70'), (D2, v_night, now(), 68.340, 18.790, now(), false, null),
           (X, v_night, now(), null, null, null, false, null);
  update public.ride_flags set on_ = true where key in ('ride_v2', 'ride_v2_more');

  -- ---------- 1. request with a destination (Hem) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_request2(PLAT, PLNG, 'Testkrogen', 2, null, 'Lisa', HLAT, HLNG, 'Hem', 'Marnäs, Ludvika', 'home');
  perform set_config('role', 'none', true);
  v_id := (j ->> 'id')::bigint;
  if j ->> 'role' = 'rider' and j -> 'dest' ->> 'kind' = 'home' and (j -> 'dest' ->> 'lat')::float8 = HLAT and j -> 'dest' ->> 'area' = 'Marnäs, Ludvika'
     and (j -> 'dest' ->> 'trip_m')::int between 2000 and 4000 and (j -> 'dest' ->> 'trip_min')::int >= 1 and (j ->> 'pk_lat')::float8 = PLAT
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL1:' || j::text; end if;

  -- ---------- 2. the offer: area + trip only, no exact point, no name; driver minutes ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  s1 := public.ride_stamp_get() ->> 's';
  j := public.ride_poll(68.340, 18.790, false);
  perform set_config('role', 'none', true);
  o := j -> 'ride' -> 'offers' -> 0;
  if o ->> 'role' = 'asked' and o -> 'dest' ->> 'area' = 'Marnäs, Ludvika' and o -> 'dest' -> 'lat' is null and o -> 'dest' -> 'name' is null
     and (o -> 'dest' ->> 'trip_m')::int > 0 and o -> 'pk_lat' is null and (o ->> 'drv_min')::int >= 1
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL2:' || coalesce(o::text, j::text); end if;

  -- ---------- 3. push text has the destination area + trip ----------
  j := public.ride_push_claim(R, v_id);
  if j::text like '%Från Testkrogen → Marnäs, Ludvika · 2 pers%' and j::text like '%resa ca %km%' and j::text not like '%68.362%'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL3:' || j::text; end if;

  -- ---------- 4. stamp: changes when something changes; a stranger sees nothing ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.ride_decline(v_id);
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  s2 := public.ride_stamp_get() ->> 's';
  perform set_config('request.jwt.claims', json_build_object('sub', X, 'role', 'authenticated')::text, true);
  j := public.ride_stamp_get();
  perform set_config('role', 'none', true);
  if s1 is not null and s2 is not null and s1 <> s2 and (j ->> 'n')::int = 0 and (j ->> 'on')::boolean
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL4:' || coalesce(s1, '-') || '/' || coalesce(s2, '-') || '/' || j::text; end if;

  -- ---------- 5. take (Oskar 1.1 km away) + position: still 'taken' ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_take(v_id);
  o := public.ride_pos(v_id, PLAT + 0.01, PLNG);
  perform set_config('role', 'none', true);
  if (j ->> 'ok')::boolean and o ->> 'status' = 'taken' and (select status from public.pickup_reqs where id = v_id) = 'taken'
     and (j -> 'ride' -> 'dest' ->> 'lat')::float8 = HLAT and j -> 'ride' -> 'dest' ->> 'name' = 'Hem'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL5:' || j::text || ' ' || o::text; end if;

  -- ---------- 6. order: the rider cannot end or skip; the taker cannot skip ----------
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_step(v_id, 'done');
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  o := public.ride_step(v_id, 'arrived');
  perform set_config('role', 'none', true);
  if j ->> 'code' = 'order' and o ->> 'code' = 'order' and (select status from public.pickup_reqs where id = v_id) = 'taken'
     and not ((select step_at from public.pickup_reqs where id = v_id) ? 'picked')
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL6:' || j::text || ' ' || o::text; end if;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    j := public.ride_step(v_id, 'enroute');
    j := jsonb_build_object('err', 'none');
  exception when others then j := jsonb_build_object('err', sqlerrm); end;
  perform set_config('role', 'none', true);
  if j ->> 'err' = 'not_taker' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL6b:' || j::text; end if;

  -- ---------- 7. På väg (tap) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_step(v_id, 'enroute');
  perform set_config('role', 'none', true);
  update public.pickup_reqs set drv_at = now() - interval '5 seconds' where id = v_id;
  perform set_config('role', 'authenticated', true);
  o := public.ride_pos(v_id, PLAT + 0.009, PLNG);
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'enroute' and o ->> 'status' = 'enroute' then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL7:' || j::text || ' ' || o::text; end if;

  -- ---------- 7b. "Ring?": no number by default; ask → push → Ja (typed number) → only the asker gets tel ----------
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_poll(null, null, false);
  o := public.ride_call_ask(v_id);
  perform set_config('role', 'none', true);
  if j -> 'ride' -> 'mine' -> 'call' ->> 'tel' is null and o -> 'call' -> 'out' ->> 'answer' is null and (o -> 'call' -> 'out' ->> 'id') is not null
     and public.ride_push_claim(R, v_id)::text like '%Lisa vill ringa dig%' and j::text not like '%070%'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL7b1:' || o::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_poll(null, null, false);
  begin o := public.ride_call_answer(v_id, true, null); o := jsonb_build_object('err', 'none');
  exception when others then o := jsonb_build_object('err', sqlerrm); end;
  perform set_config('role', 'none', true);
  if j -> 'ride' -> 'drive' -> 'call' -> 'in' is not null and not (j -> 'ride' -> 'drive' -> 'call' -> 'in' ->> 'saved')::boolean and o ->> 'err' = 'no_phone'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL7b2:' || o::text || coalesce((j -> 'ride' -> 'drive' -> 'call')::text, '-'); end if;
  perform set_config('role', 'authenticated', true);
  o := public.ride_call_answer(v_id, true, '070-123 45 67');
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  j := public.ride_poll(null, null, false);
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  s1 := public.ride_poll(null, null, false)::text;
  perform set_config('role', 'none', true);
  if j -> 'ride' -> 'mine' -> 'call' ->> 'tel' = '0701234567' and o -> 'call' ->> 'tel' is null and s1 not like '%0701234567%'
     and not exists (select 1 from public.ride_msgs m where m.req_id = v_id and m.body like '%070%')
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL7b3:' || coalesce((j -> 'ride' -> 'mine' -> 'call')::text, j::text); end if;
  -- the driver asks; Lisa says Nej twice → a third ask = slow_down
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.ride_call_ask(v_id);
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform public.ride_call_answer(v_id, false, null);
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform public.ride_call_ask(v_id);
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform public.ride_call_answer(v_id, false, null);
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  j := public.ride_poll(null, null, false);
  begin o := public.ride_call_ask(v_id); o := jsonb_build_object('err', 'none');
  exception when others then o := jsonb_build_object('err', sqlerrm); end;
  perform set_config('role', 'none', true);
  if o ->> 'err' = 'slow_down' and j -> 'ride' -> 'drive' -> 'call' ->> 'tel' is null and j -> 'ride' -> 'drive' -> 'call' -> 'out' ->> 'answer' = 'no'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL7b4:' || o::text || coalesce((j -> 'ride' -> 'drive' -> 'call')::text, '-'); end if;

  -- ---------- 8. Jag är här → arrived push; Klar before "sitter i bilen" = order ----------
  perform set_config('role', 'authenticated', true);
  j := public.ride_step(v_id, 'arrived');
  o := public.ride_step(v_id, 'done');
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'arrived' and o ->> 'code' = 'order' and o ->> 'status' = 'arrived'
     and public.ride_push_claim(D1, v_id)::text like '%Oskar ä framme%'
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL8:' || j::text || ' ' || o::text; end if;

  -- ---------- 9. rider "Jag sitter i bilen" (also a 0420 app's 'done') = picked, never done ----------
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_step(v_id, 'done');
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'arrived' and (j -> 'step_at') ? 'picked' and j -> 'step_at' ->> 'picked_by' = 'rider' and (j ->> 'live')::boolean
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL9:' || j::text; end if;

  -- ---------- 10. Klar by the driver → done, award, exact destination gone for the taker ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_step(v_id, 'done');
  perform set_config('role', 'none', true);
  if j ->> 'status' = 'done' and j -> 'dest' ->> 'lat' is null and j -> 'dest' ->> 'area' = 'Marnäs, Ludvika'
     and (select n from public.ride_awards where user_id = D1 and night = v_night) = 1
     and (select drv_lat is null from public.pickup_reqs where id = v_id)
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL10:' || coalesce((select string_agg(n::text || '@' || night::text, ',') from public.ride_awards where user_id = D1), 'no award') || ' drv=' || coalesce((select drv_lat::text from public.pickup_reqs where id = v_id), 'null'); end if;

  -- the number is gone when the ride ends; the consent log stays
  if (select count(*) from public.ride_calls where req_id = v_id and phone is not null) = 0
     and (select count(*) from public.ride_calls where req_id = v_id and answer = 'yes' and from_uid = R) = 1
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL10b'; end if;

  -- ---------- 11. the other driver never sees the exact destination; old ride_request = no destination ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_poll(null, null, false);
  perform set_config('role', 'none', true);
  if not (j::text like '%68.362%') then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL11:' || j::text; end if;
  update public.pickup_reqs set created_at = now() - interval '2 minutes' where id = v_id;
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_request(PLAT, PLNG, null, 1, null, 'Lisa');
  perform set_config('role', 'none', true);
  if j ? 'dest' and j -> 'dest' = 'null'::jsonb and (j ->> 'v3')::boolean then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL11b:' || j::text; end if;

  -- ---------- 11c. same house: take + first position at the pickup → På väg AND Framme marked (both phones the same) ----------
  update public.pickup_reqs set created_at = now() - interval '3 minutes' where user_id = R;
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.ride_cancel((j ->> 'id')::bigint);
  j := public.ride_request2(PLAT, PLNG, 'Testkrogen', 1, null, 'Lisa', null, null, null, null, null);
  v_id2 := (j ->> 'id')::bigint;
  perform set_config('request.jwt.claims', json_build_object('sub', D1, 'role', 'authenticated')::text, true);
  j := public.ride_take(v_id2);
  o := public.ride_pos(v_id2, PLAT, PLNG);
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true);
  j := public.ride_poll(null, null, false);
  perform set_config('role', 'none', true);
  if o ->> 'status' = 'arrived' and j -> 'ride' -> 'mine' ->> 'status' = 'arrived' and (j -> 'ride' -> 'mine' -> 'step_at') ? 'enroute'
     and (j -> 'ride' -> 'mine' -> 'step_at') ? 'arrived' and j -> 'ride' -> 'mine' -> 'dest' = 'null'::jsonb
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL11c:' || o::text || ' ' || coalesce((j -> 'ride' -> 'mine')::text, j::text); end if;

  -- ---------- 13. LÄSK!: a soda for the driver, never a drink; 1 per 60 s ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.ride_lask_post(68.34, 18.79);
  begin o := public.ride_lask_post(68.34, 18.79); o := jsonb_build_object('err', 'none');
  exception when others then o := jsonb_build_object('err', sqlerrm); end;
  perform set_config('role', 'none', true);
  if (j ->> 'n')::int = 1 and o ->> 'err' = 'slow_down' and not public.olnu_ride_drinking(D2)
     and not exists (select 1 from public.drink_log d where d.user_id = D2) and not exists (select 1 from public.beers b where b.user_id = D2)
     and D2 = any (public.olnu_ride_eligible(R, false))
  then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL13:' || j::text || ' ' || o::text; end if;

  -- ---------- 12. flag off → stamp says on:false ----------
  update public.ride_flags set on_ = false where key = 'ride_v2';
  perform set_config('role', 'authenticated', true);
  j := public.ride_stamp_get();
  perform set_config('role', 'none', true);
  if not (j ->> 'on')::boolean then pass := pass + 1; else fail := fail + 1; msg := msg || ' FAIL12:' || j::text; end if;

  raise exception 'RIDE3_SQL pass=% fail=% |%', pass, fail, msg;
end $$;
