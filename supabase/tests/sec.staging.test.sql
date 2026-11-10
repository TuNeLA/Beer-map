-- sec lane tests for 0430 (Bara vänner check-ins, olnu_pins order, owner key limit per caller, group_league),
-- 0431 (block filter) and 0435 (crash alert). Run on STAGING after 0430/0431/0435 (never on live): paste into the SQL
-- editor or the Supabase MCP execute_sql. One DO block. It ALWAYS ends with "raise exception 'SEC-TEST …'", so every
-- row it made (fresh users that exist only inside this transaction, a group, pins, rallies, fake log rows, the alert
-- settings) is rolled back. Read the PASS / FAIL lines in the error text. Location: the test zone (68.35 / 18.80).
do $test$
declare
  res text[] := '{}';
  uv uuid := gen_random_uuid();   -- V: blocks K, friends-only
  uk uuid := gen_random_uuid();   -- K: blocked by V, same group
  um uuid := gen_random_uuid();   -- M: group mate of V (control: still sees V)
  us uuid := gen_random_uuid();   -- S: stranger
  uo uuid := gen_random_uuid();   -- O: the owner's phone (crash alert)
  g uuid := gen_random_uuid();
  j jsonb; t text; n int; ok boolean; vk text; e text;
  cu uuid[] := array[]::uuid[]; i int;
  claims text;
begin
  -- ---------- data ----------
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
    select x, 'authenticated', 'authenticated', true, now(), now() from unnest(array[uv, uk, um, us, uo]) x;
  insert into public.groups (id, name, code) values (g, 'Sec testgäng', 'S' || substr(translate(upper(md5(random()::text)), '01IO', '2345'), 1, 5));
  insert into public.group_members (group_id, user_id, display_name) values (g, uv, 'SecVicZq'), (g, uk, 'SecBlkZq'), (g, um, 'SecMateZq');
  insert into public.beers (user_id, lat, lng, precise, beer_count, expires_at)
    select u, 68.35 + x * 0.001, 18.80, false, 1, now() + interval '3 hours' from (values (uv, 1), (uk, 2), (um, 3), (us, 4)) v(u, x);
  insert into public.checkins (user_id, bar_id, bar_name, lat, lng, expires_at)
    values (uv, 'sec-test-bar', 'SecTestKrog', 68.3521, 18.8011, now() + interval '2 hours');
  insert into public.rallies (group_id, user_id, body, place, lat, lng) values (g, uv, 'SecRallyZq', 'SecTestKrog', 68.3521, 18.8011);
  insert into public.group_msgs (group_id, user_id, body, expires_at) values (g, uv, 'SecMsgZq', public.olnu_next_expiry());
  insert into public.olnu_visibility (user_id, friends_only) values (uv, true);
  insert into public.user_blocks (blocker, blocked, active) values (uv, uk, true);
  vk := public.olnu_chief_k(g, uv);

  -- ---------- 0430 F1: olnu_pins has the "Bara vänner" condition ----------
  ok := position('olnu_visibility' in pg_get_functiondef('public.olnu_pins(uuid,float8,float8,float8,float8)'::regprocedure)) > 0;
  res := res || ((case when ok then 'PASS' else 'FAIL' end) || ' F1 olnu_pins reads olnu_visibility');

  -- ---------- 0430 F2: friends-only check-in never reaches a stranger; the group mate still sees it ----------
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  t := public.poll_v2(68.30, 18.70, 68.40, 18.90, null, false)::text;
  res := res || ((case when position('sec-test-bar' in t) = 0 then 'PASS' else 'FAIL' end) || ' F2 stranger poll_v2: no check-in of a friends-only user');
  t := coalesce((select json_agg(x)::text from public.live_checkins() x), '');
  res := res || ((case when position('sec-test-bar' in t) = 0 then 'PASS' else 'FAIL' end) || ' F2 stranger live_checkins: no check-in of a friends-only user');
  perform set_config('request.jwt.claims', '', true);
  t := public.poll_public(68.30, 18.70, 68.40, 18.90, false)::text;
  res := res || ((case when position('sec-test-bar' in t) = 0 then 'PASS' else 'FAIL' end) || ' F2 anon poll_public: no check-in of a friends-only user');
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  t := public.poll_v2(68.30, 18.70, 68.40, 18.90, null, false)::text;
  res := res || ((case when position('sec-test-bar' in t) > 0 and position('SecVicZq' in t) > 0 then 'PASS' else 'FAIL' end) || ' F2 control: the group mate still sees the check-in with the name');
  update public.olnu_visibility set friends_only = false where user_id = uv;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  t := public.poll_v2(68.30, 18.70, 68.40, 18.90, null, false)::text;
  res := res || ((case when position('sec-test-bar' in t) > 0 and position('SecVicZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' F2 control: with Alla the stranger sees the check-in, without a name');
  update public.olnu_visibility set friends_only = true where user_id = uv;

  -- ---------- 0430 F4: group_league gives no other group's id ----------
  select count(*) into n from public.group_league() x where not x.is_mine and x.group_id is not null;
  res := res || ((case when n = 0 then 'PASS' else 'FAIL' end) || ' F4 group_league: no foreign group ids (' || n || ')');

  -- ---------- 0430 F3: owner key limit per caller (IP header bucket), not global ----------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '{"cf-connecting-ip":"198.51.100.7"}', true);
  for i in 1 .. 21 loop perform public.olnu_wd_owner_ok('wrong-' || i); end loop;
  begin
    perform public.olnu_wd_owner_ok('wrong-22'); e := 'none';
  exception when others then e := sqlerrm;
  end;
  res := res || ((case when e = 'rate_limited' then 'PASS' else 'FAIL' end) || ' F3 caller A: 22nd wrong key = rate_limited (' || e || ')');
  perform set_config('request.headers', '{"cf-connecting-ip":"198.51.100.8"}', true);
  begin
    ok := public.olnu_wd_owner_ok('wrong-other'); e := 'none';
  exception when others then e := sqlerrm;
  end;
  res := res || ((case when e = 'none' and not ok then 'PASS' else 'FAIL' end) || ' F3 caller B is NOT locked out by caller A (' || e || ')');
  perform set_config('request.headers', '', true);

  -- ---------- 0431: K (blocked by V) sees nothing of V; M (control) still sees V ----------
  perform set_config('request.jwt.claims', json_build_object('sub', uk, 'role', 'authenticated')::text, true);
  t := coalesce((select json_agg(x)::text from public.group_rallies(g) x), '');
  res := res || ((case when position('SecRallyZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B group_rallies: no rally of the blocker');
  t := public.my_inbox()::text;
  res := res || ((case when position('SecRallyZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B my_inbox: no rally of the blocker');
  t := public.poll_v2(68.30, 18.70, 68.40, 18.90, null, false)::text;
  res := res || ((case when position('SecRallyZq' in t) = 0 and position('SecVicZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B poll_v2: no rally / name of the blocker');
  t := public.crew_group(g)::text;
  res := res || ((case when position('SecVicZq' in t) = 0 and position('SecTestKrog' in t) = 0 then 'PASS' else 'FAIL' end) || ' B crew_group: no name / bar of the blocker');
  t := coalesce((public.chief_state(g)::jsonb -> 'members')::text, '');
  res := res || ((case when position('SecVicZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B chief_state: blocker not in the member list');
  t := public.group_friend_states(g)::text;
  res := res || ((case when position('SecVicZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B group_friend_states: blocker not listed');
  t := coalesce((select json_agg(x)::text from public.home_status(false) x), '');
  res := res || ((case when position('SecVicZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B home_status: blocker not listed');
  t := public.friend_list(null)::text;
  res := res || ((case when position('SecVicZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B friend_list: blocker not suggested');
  t := public.group_night_story(g, (now() at time zone 'Europe/Stockholm')::date)::text;
  res := res || ((case when position('SecVicZq' in t) = 0 and position('SecMsgZq' in t) = 0 and position('SecRallyZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B group_night_story: no name / chat / rally of the blocker');
  t := public.gang_group(g)::text;
  res := res || ((case when position('SecVicZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B gang_group: blocker not listed');
  t := coalesce((select json_agg(x)::text from public.member_medals(g) x), '');
  res := res || ((case when position('SecVicZq' in t) = 0 then 'PASS' else 'FAIL' end) || ' B member_medals: blocker not listed');
  begin
    j := public.friend_request(null, g, vk, null); e := 'none';
  exception when others then e := sqlerrm;
  end;
  res := res || ((case when e = 'friend_not_found' then 'PASS' else 'FAIL' end) || ' B friend_request to the blocker = friend_not_found (' || e || ')');

  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  t := coalesce((select json_agg(x)::text from public.group_rallies(g) x), '') || public.crew_group(g)::text || public.group_friend_states(g)::text
       || coalesce((select json_agg(x)::text from public.home_status(false) x), '') || public.chief_state(g)::text;
  res := res || ((case when position('SecRallyZq' in t) > 0 and (length(t) - length(replace(t, 'SecVicZq', ''))) / 8 >= 4 then 'PASS' else 'FAIL' end) || ' B control: the mate still sees the blocker everywhere');
  perform set_config('request.jwt.claims', '', true);

  -- ---------- 0435: crash alert ----------
  update public.sec_crash_alert set on_ = false, owner_uid = null, last_sent_at = null where id = 1;
  j := public.crash_alert_claim();
  res := res || ((case when j ->> 'why' = 'off' then 'PASS' else 'FAIL' end) || ' X7 flag off = no send (' || j::text || ')');
  update public.sec_crash_alert set on_ = true, owner_uid = uo, min_users = 5, cooldown_min = 180 where id = 1;
  for i in 1 .. 6 loop cu := cu || gen_random_uuid(); end loop;
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) select x, 'authenticated', 'authenticated', true, now(), now() from unnest(cu) x;
  -- 5 crashed users + 1 user with only an rpc error (does not count)
  insert into public.pn_events (user_id, day, at, sess, n, bytes, ev)
    select cu[gs.k], public.pnlog_day(now()), now() - interval '5 minutes', 'sec-test-' || gs.k, 1, 10,
           case when gs.k <= 5 then '[{"n":"err.js","p":{"m":"SecTypeError"}}]'::jsonb else '[{"n":"err.rpc","p":{"fn":"x","c":"slow_down"}}]'::jsonb end
      from generate_series(1, 6) gs(k);
  j := public.crash_alert_claim();
  res := res || ((case when j ->> 'why' = 'below' and (j ->> 'users')::int >= 5 then 'PASS' else 'FAIL' end) || ' X7 5 users (= N) is not MORE than N: no send (' || j::text || ')');
  insert into public.client_vitals (user_id, errors, err_first) values (cu[6], 2, 'SecVitalsError');
  j := public.crash_alert_claim();
  res := res || ((case when (j ->> 'send')::boolean and j ->> 'owner' = uo::text and (j ->> 'users')::int >= 6 then 'PASS' else 'FAIL' end) || ' X7 6 users > 5: send to the owner only (' || j::text || ')');
  j := public.crash_alert_claim();
  res := res || ((case when j ->> 'why' = 'cooldown' then 'PASS' else 'FAIL' end) || ' X7 second claim within 3 h = cooldown (' || (j ->> 'why') || ')');
  update public.sec_crash_alert set last_sent_at = now() - interval '181 minutes' where id = 1;
  j := public.crash_alert_claim();
  res := res || ((case when (j ->> 'send')::boolean then 'PASS' else 'FAIL' end) || ' X7 after the cooldown it can send again');
  update public.sec_crash_alert set last_sent_at = null, owner_uid = null where id = 1;
  update public.bar_area_trusted set active = false where active;   -- (rolled back) no fallback owner
  j := public.crash_alert_claim();
  res := res || ((case when j ->> 'why' = 'no_owner' then 'PASS' else 'FAIL' end) || ' X7 no owner known = no send');
  j := public.owner_crash_alert('sec-wrong-key', true, 3, null, false);
  res := res || ((case when j ->> 'code' = 'PT403' then 'PASS' else 'FAIL' end) || ' X7 owner_crash_alert with a wrong key = forbidden');
  select has_function_privilege('authenticated', 'public.crash_alert_claim()', 'EXECUTE') or has_function_privilege('anon', 'public.crash_alert_claim()', 'EXECUTE') into ok;
  res := res || ((case when not ok then 'PASS' else 'FAIL' end) || ' X7 crash_alert_claim is not callable by anon / authenticated');

  raise exception 'SEC-TEST % PASS / % FAIL: %', (select count(*) from unnest(res) r where r like 'PASS%'),
    (select count(*) from unnest(res) r where r like 'FAIL%'), array_to_string(res, ' | ');
end $test$;
