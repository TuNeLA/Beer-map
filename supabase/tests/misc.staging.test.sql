-- misc lane tests for 0400 (film reports, film_block), 0401 (founders), 0402 (deletion grace), 0403 (block filter).
-- Run on STAGING after 0400–0403 (never on live): paste into the SQL editor or the Supabase MCP execute_sql.
-- One DO block. It ALWAYS ends with "raise exception 'MISC-TEST …'", so every row it made (3 fresh users that exist only
-- inside this transaction, groups, pins, photos, the test owner key) is rolled back. Read the PASS / FAIL lines in the
-- error text. Location: the test zone (68.35 / 18.80).
-- 0403 check "same as before": the old version of each patched function is rebuilt from the deployed one (the 0403 text
-- swap in reverse) in a schema that also exists only inside the transaction, and both answers are compared.
do $test$
declare
  res text[] := '{}';
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid();
  ga uuid := gen_random_uuid(); gd uuid := gen_random_uuid();
  v_night timestamptz := public.olnu_night_of(now()) - interval '1 day';
  p1 bigint; p2 bigint;
  j jsonb; j2 jsonb; t text; n int; ok boolean;
  k text := 'misc-test-key-' || md5(random()::text);
  f record;
  pairs text[][] := array[
    ['group_status_v2(uuid)', 'where gm.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, gm.user_id)', 'where gm.group_id = p_group_id'],
    ['group_now(uuid)', ' and not public.olnu_ub_hidden(v_uid, gm.user_id)', ''],
    ['ikvall_status(uuid)', ' and not public.olnu_ub_hidden(v_uid, p.uid)', ''],
    ['my_dms()', 'where (d.a = v_uid or d.b = v_uid) and not public.olnu_ub_hidden(v_uid, case when d.a = v_uid then d.b else d.a end)', 'where d.a = v_uid or d.b = v_uid'],
    ['film_roll(uuid, timestamp with time zone)', E'\n                           and not public.olnu_ub_hidden(v_uid, sp.user_id)), ''[]''::jsonb));', '), ''[]''::jsonb));'],
    ['poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)', 'where not public.olnu_ub_hidden(v_uid, c.user_id) and (c.user_id = v_uid or f.fname is not null', 'where c.user_id = v_uid or f.fname is not null'],
    ['live_checkins()', ' and not public.olnu_ub_hidden(v_uid, c.user_id)', ''],
    ['group_etas()', ' and not public.olnu_ub_hidden(v_uid, e.user_id)', '']];
  i int;
begin
  -- ---------- helpers ----------
  create schema misc_old;
  -- old copies of the patched functions (0403 in reverse)
  for i in 1 .. array_length(pairs, 1) loop
    t := pg_get_functiondef(('public.' || pairs[i][1])::regprocedure);
    t := replace(t, pairs[i][2], pairs[i][3]);
    if pairs[i][1] like 'group_now%' then
      t := replace(t, ' and not public.olnu_ub_hidden(v_uid, m.user_id)', '');
    end if;
    if pairs[i][1] like 'poll_v2%' then
      t := replace(t, 'or (c.lat between v_a and v_c and c.lng between v_b and v_d))),', 'or (c.lat between v_a and v_c and c.lng between v_b and v_d)),');
    end if;
    t := regexp_replace(t, 'FUNCTION public\.', 'FUNCTION misc_old.');
    if position('olnu_ub_hidden' in t) > 0 then
      res := res || ('FAIL rebuild old ' || pairs[i][1]);
    end if;
    execute t;
  end loop;

  -- ---------- data: 3 fresh anonymous users, one group, one DM, pins + check-ins in the test zone ----------
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values
    (ua, 'authenticated', 'authenticated', true, now() - interval '2 days', now()),
    (ub, 'authenticated', 'authenticated', true, now(), now()),
    (uc, 'authenticated', 'authenticated', true, now() - interval '3 days', now());
  insert into public.groups (id, name, code) values (ga, 'Misc testgäng', 'Q' || substr(translate(upper(md5(random()::text)), '01IO', '2345'), 1, 5));
  insert into public.group_members (group_id, user_id, display_name) values (ga, ua, 'Alfa'), (ga, ub, 'Bravo'), (ga, uc, 'Charlie');
  insert into public.beers (user_id, lat, lng, precise, beer_count, expires_at)
    select u, 68.35 + x * 0.001, 18.80, true, 2, now() + interval '3 hours' from (values (ua, 1), (ub, 2), (uc, 3)) v(u, x);
  insert into public.checkins (user_id, bar_id, bar_name, lat, lng, expires_at) values
    (ub, 'misc-test-bar', 'Misc testkrog', 68.352, 18.80, now() + interval '2 hours'),
    (uc, 'misc-test-bar', 'Misc testkrog', 68.353, 18.80, now() + interval '2 hours');
  insert into public.ikvall_status (user_id, night, st) values (ub, public.olnu_night_of(now()), 'ute'), (uc, public.olnu_night_of(now()), 'kanske');
  insert into public.groups (id, name, code) values (gd, 'DM', 'Z' || substr(translate(upper(md5(random()::text)), '01IO', '2345'), 1, 5));
  insert into public.dm_threads (group_id, a, b, created_by) values (gd, least(ua, ub), greatest(ua, ub), ua);
  insert into public.group_msgs (group_id, user_id, body, expires_at) values (gd, ub, 'Tjena Alfa', now() + interval '3 hours'),
    (ga, ub, 'Hej gänget', now() + interval '3 hours');
  insert into public.snap_photos (kind, group_id, user_id, night, mime, bytes, size, w, h, reveal_at, expires_at)
    values ('film', ga, ub, v_night, 'image/jpeg', '\xffd8ffd9'::bytea, 4, 10, 10, now() - interval '1 hour', now() + interval '5 days') returning id into p1;
  insert into public.snap_photos (kind, group_id, user_id, night, mime, bytes, size, w, h, reveal_at, expires_at)
    values ('film', ga, uc, v_night, 'image/jpeg', '\xffd8ffd9'::bytea, 4, 10, 10, now() - interval '1 hour', now() + interval '5 days') returning id into p2;
  insert into public.owner_keys (key_hash) values (encode(extensions.digest(k, 'sha256'), 'hex'));

  -- ---------- 0403: no block → same answer as before, for all 3 users ----------
  for f in select * from (values (ua, 'A'), (ub, 'B'), (uc, 'C')) v(u, nm) loop
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', f.u, 'role', 'authenticated')::text, true);
    ok := (select coalesce(jsonb_agg(x), '[]') from public.group_status_v2(ga) x) = (select coalesce(jsonb_agg(x), '[]') from misc_old.group_status_v2(ga) x)
      and public.group_now(ga) = misc_old.group_now(ga)
      and public.ikvall_status(ga) = misc_old.ikvall_status(ga) and public.ikvall_status(null) = misc_old.ikvall_status(null)
      and public.my_dms() = misc_old.my_dms()
      and public.film_roll(ga, v_night) = misc_old.film_roll(ga, v_night)
      and public.poll_v2(68.3, 18.7, 68.4, 18.9, null, false)::jsonb = misc_old.poll_v2(68.3, 18.7, 68.4, 18.9, null, false)::jsonb
      and (select coalesce(jsonb_agg(x), '[]') from public.live_checkins() x) = (select coalesce(jsonb_agg(x), '[]') from misc_old.live_checkins() x)
      and (select coalesce(jsonb_agg(x), '[]') from public.group_etas() x) = (select coalesce(jsonb_agg(x), '[]') from misc_old.group_etas() x);
    res := res || ((case when ok then 'PASS' else 'FAIL' end) || ' 0403 no block: 8 reads same as before for ' || f.nm);
  end loop;
  -- precondition: A sees Bravo before the block
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  res := res || ((case when exists (select 1 from public.group_status_v2(ga) x where x.name = 'Bravo') and jsonb_array_length(public.my_dms() -> 'threads') = 1
                  and jsonb_array_length(public.film_roll(ga, v_night) -> 'photos') = 2 then 'PASS' else 'FAIL' end) || ' setup: A sees Bravo, the DM and 2 film photos');

  -- ---------- 0400: film report → owner queue → OK / hide; film_block ----------
  j := public.film_report(p1, 'sex');
  res := res || ((case when (j ->> 'hidden_all')::boolean = false then 'PASS' else 'FAIL' end) || ' film_report 1st report: not hidden for all');
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  j := public.film_report(p1, 'sex');
  res := res || ((case when (j ->> 'hidden_all')::boolean and (select sp.expires_at <= now() and sp.bytes is not null from public.snap_photos sp where sp.id = p1)
                  then 'PASS' else 'FAIL' end) || ' film_report 2nd reporter: hidden for all by expires_at, bytes kept for the owner');
  j := public.owner_film_reports('wrong-key', 'new');
  res := res || ((case when j ->> 'message' = 'forbidden' then 'PASS' else 'FAIL' end) || ' owner_film_reports: wrong key = forbidden');
  j := public.owner_film_reports(k, 'new');
  j2 := (select x from jsonb_array_elements(j -> 'reports') x where (x ->> 'id')::bigint = p1);
  res := res || ((case when j2 is not null and j2 ->> 'kind' = 'film' and (j2 ->> 'same')::int = 2 and j2 ->> 'reason' = 'sex' and j2 ->> 'status' = 'new'
                  and (j2 ->> 'auto_hidden')::boolean and (j ->> 'open')::int >= 1 then 'PASS' else 'FAIL' end) || ' owner queue lists the film photo (2 reporters, sex, open)');
  res := res || ((case when (public.owner_film_photo(k, p1) ->> 'ok')::boolean and public.owner_film_photo(k, p2) ->> 'ok' = 'false' then 'PASS' else 'FAIL' end)
                 || ' owner_film_photo: reported photo yes, unreported no');
  j := public.owner_film_act(k, p1, 'dismiss', null);
  res := res || ((case when (j ->> 'restored')::boolean and (select sp.expires_at > now() from public.snap_photos sp where sp.id = p1) then 'PASS' else 'FAIL' end)
                 || ' owner OK brings back the auto-hidden photo');
  j := public.owner_film_reports(k, 'dismissed');
  res := res || ((case when exists (select 1 from jsonb_array_elements(j -> 'reports') x where (x ->> 'id')::bigint = p1)
                  and not exists (select 1 from jsonb_array_elements(public.owner_film_reports(k, 'new') -> 'reports') x where (x ->> 'id')::bigint = p1)
                  then 'PASS' else 'FAIL' end) || ' after OK: under OK, not open');
  j := public.owner_film_act(k, p1, 'hide', null);
  res := res || ((case when (select sp.expires_at <= now() from public.snap_photos sp where sp.id = p1)
                  and (select fm.status = 'hidden' and fm.notice is not null from public.film_mod fm where fm.photo_id = p1) then 'PASS' else 'FAIL' end)
                 || ' owner Ta bort: photo gone for all, status hidden, notice set');
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  j := public.safety_state(false);
  res := res || ((case when exists (select 1 from jsonb_array_elements(j -> 'notices') x where x ->> 'kind' = 'film') then 'PASS' else 'FAIL' end)
                 || ' safety_state: the photographer gets the film notice');
  j := public.safety_state(true); j := public.safety_state(false);
  res := res || ((case when not exists (select 1 from jsonb_array_elements(j -> 'notices') x where x ->> 'kind' = 'film') then 'PASS' else 'FAIL' end)
                 || ' safety_state(seen): the notice shows once');
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  t := 'none'; begin perform public.film_block(p2); exception when others then t := sqlerrm; end;
  res := res || ((case when t = 'own_content' then 'PASS' else 'FAIL' end) || ' film_block on own photo = own_content');

  -- ---------- 0403: A blocks B (through film_block on B''s photo) → gone both ways; C unchanged ----------
  update public.snap_photos sp set expires_at = now() + interval '5 days' where sp.id = p1;   -- photo back for the block test
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  j := public.film_block(p1);
  res := res || ((case when (j ->> 'ok')::boolean and exists (select 1 from public.user_blocks b where b.blocker = ua and b.blocked = ub and b.active)
                  then 'PASS' else 'FAIL' end) || ' film_block: A blocks the photographer B');
  for f in select * from (values (ua, 'A', 'Bravo'), (ub, 'B', 'Alfa')) v(u, nm, other) loop
    perform set_config('request.jwt.claims', json_build_object('sub', f.u, 'role', 'authenticated')::text, true);
    res := res || ((case when not exists (select 1 from public.group_status_v2(ga) x where x.name = f.other)
                    and exists (select 1 from misc_old.group_status_v2(ga) x where x.name = f.other)
                    and exists (select 1 from public.group_status_v2(ga) x where x.name = 'Charlie') then 'PASS' else 'FAIL' end)
                   || ' block: ' || f.nm || ' member list has no ' || f.other || ', still Charlie');
    res := res || ((case when not (public.group_now(ga)::text like '%' || f.other || '%') and misc_old.group_now(ga)::text like '%' || f.other || '%'
                    then 'PASS' else 'FAIL' end) || ' block: ' || f.nm || ' group_now has no ' || f.other);
    res := res || ((case when jsonb_array_length(public.my_dms() -> 'threads') = 0 and jsonb_array_length(misc_old.my_dms() -> 'threads') = 1
                    then 'PASS' else 'FAIL' end) || ' block: ' || f.nm || ' DM list is empty');
    res := res || ((case when not exists (select 1 from public.group_msgs(ga, 0) x where x.name = f.other) or f.nm = 'B' then 'PASS' else 'FAIL' end)
                   || ' block: ' || f.nm || ' chat has no ' || f.other || ' (0206)');
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  res := res || ((case when not (public.ikvall_status(ga)::text like '%Bravo%') and misc_old.ikvall_status(ga)::text like '%Bravo%' then 'PASS' else 'FAIL' end)
                 || ' block: A Ikväll? has no Bravo');
  res := res || ((case when jsonb_array_length(public.film_roll(ga, v_night) -> 'photos') = 1 and jsonb_array_length(misc_old.film_roll(ga, v_night) -> 'photos') = 2
                  then 'PASS' else 'FAIL' end) || ' block: A film roll has 1 photo (not B''s)');
  t := 'none'; begin perform public.film_photo(p1); exception when others then t := sqlerrm; end;
  res := res || ((case when t = 'photo_not_found' then 'PASS' else 'FAIL' end) || ' block: A cannot load B''s film photo');
  res := res || ((case when not exists (select 1 from json_array_elements(public.poll_v2(68.3, 18.7, 68.4, 18.9, null, false) -> 'checkins') x where (x ->> 'name') = 'Bravo')
                  and (select count(*) from json_array_elements(public.poll_v2(68.3, 18.7, 68.4, 18.9, null, false) -> 'checkins') x where (x ->> 'bar_id') = 'misc-test-bar') = 1
                  and (select count(*) from json_array_elements(misc_old.poll_v2(68.3, 18.7, 68.4, 18.9, null, false) -> 'checkins') x where (x ->> 'bar_id') = 'misc-test-bar') = 2
                  then 'PASS' else 'FAIL' end) || ' block: A map check-ins have no Bravo (Charlie stays)');
  res := res || ((case when (select count(*) from public.live_checkins() x where x.bar_id = 'misc-test-bar') = 1 then 'PASS' else 'FAIL' end)
                 || ' block: A live_checkins has no Bravo');
  res := res || ((case when not exists (select 1 from json_array_elements(public.poll_v2(68.3, 18.7, 68.4, 18.9, null, false) -> 'pins') x where (x ->> 'friend_name') = 'Bravo')
                  then 'PASS' else 'FAIL' end) || ' block: A map pins have no Bravo (0206)');
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  ok := (select coalesce(jsonb_agg(x), '[]') from public.group_status_v2(ga) x) = (select coalesce(jsonb_agg(x), '[]') from misc_old.group_status_v2(ga) x)
    and public.group_now(ga) = misc_old.group_now(ga) and public.ikvall_status(ga) = misc_old.ikvall_status(ga)
    and public.film_roll(ga, v_night) = misc_old.film_roll(ga, v_night)
    and public.poll_v2(68.3, 18.7, 68.4, 18.9, null, false)::jsonb = misc_old.poll_v2(68.3, 18.7, 68.4, 18.9, null, false)::jsonb;
  res := res || ((case when ok then 'PASS' else 'FAIL' end) || ' block A-B: C (not in the block) gets the same answers as before');

  -- ---------- 0401 founders ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  j := public.my_founder();
  res := res || ((case when (j ->> 'founder')::boolean and not (j ->> 'final')::boolean then 'PASS' else 'FAIL' end) || ' founders: no cutoff yet = founder, final false');
  j := public.owner_set_founder_cutoff('wrong-key', now());
  res := res || ((case when j ->> 'message' = 'forbidden' then 'PASS' else 'FAIL' end) || ' owner_set_founder_cutoff: wrong key = forbidden');
  t := 'none'; begin perform public.owner_set_founder_cutoff(k, now() - interval '2 years'); exception when others then t := sqlerrm; end;
  res := res || ((case when t = 'invalid_cutoff' then 'PASS' else 'FAIL' end) || ' owner_set_founder_cutoff: 2 years back = invalid_cutoff');
  j := public.owner_set_founder_cutoff(k, now() - interval '1 day');
  res := res || ((case when (j ->> 'ok')::boolean and exists (select 1 from public.founder_marks m where m.user_id = ua)
                  and not exists (select 1 from public.founder_marks m where m.user_id = ub) then 'PASS' else 'FAIL' end) || ' cutoff set: A (2 days old) marked, B (new) not');
  j := public.my_founder();
  res := res || ((case when not (j ->> 'founder')::boolean and (j ->> 'final')::boolean then 'PASS' else 'FAIL' end) || ' founders: B made after the cutoff = not founder');
  perform public.owner_set_founder_cutoff(k, now() - interval '5 days');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  res := res || ((case when (public.my_founder() ->> 'founder')::boolean and public.olnu_has_premium(ua) then 'PASS' else 'FAIL' end)
                 || ' founders: cutoff moved earlier, A keeps the mark (Premium forever)');
  j := public.owner_founders(k);
  res := res || ((case when (j ->> 'marks')::int >= 1 and j ? 'cutoff' then 'PASS' else 'FAIL' end) || ' owner_founders answers');

  -- ---------- 0402 deletion grace ----------
  j := public.request_account_deletion();
  res := res || ((case when (j ->> 'pending')::boolean and (j ->> 'days_left')::int = 7 then 'PASS' else 'FAIL' end) || ' request_account_deletion: pending, 7 days');
  j2 := public.request_account_deletion();
  res := res || ((case when j2 ->> 'due_at' = j ->> 'due_at' then 'PASS' else 'FAIL' end) || ' asking again keeps the same day');
  j := public.cancel_account_deletion();
  res := res || ((case when not (j ->> 'pending')::boolean and (j ->> 'cancelled')::boolean and not (public.my_account_deletion() ->> 'pending')::boolean
                  then 'PASS' else 'FAIL' end) || ' cancel_account_deletion (Ångra)');
  j := public.request_account_deletion();
  j := public.olnu_run_due_deletions(5);
  res := res || ((case when exists (select 1 from auth.users u where u.id = ua) then 'PASS' else 'FAIL' end) || ' runner: not due yet = account stays');
  update public.account_deletions d set due_at = now() - interval '1 minute' where d.subject = ua::text and d.status = 'pending';
  j := public.olnu_run_due_deletions(5);
  res := res || ((case when (j ->> 'done')::int >= 1 and not exists (select 1 from auth.users u where u.id = ua)
                  and not exists (select 1 from public.group_members m where m.user_id = ua)
                  and exists (select 1 from public.account_deletions d where d.status = 'done' and d.subject is null and d.done_at = now())
                  and exists (select 1 from auth.users u where u.id = ub) then 'PASS' else 'FAIL' end) || ' runner: due → delete_my_data_v2 ran as A only, row done, subject cleared');
  res := res || ((case when current_setting('request.jwt.claims', true)::jsonb ->> 'sub' = ua::text then 'PASS' else 'FAIL' end) || ' runner: claims put back after the run');

  raise exception 'MISC-TEST % PASS, % FAIL (rolled back)%', (select count(*) from unnest(res) x where x like 'PASS%'),
    (select count(*) from unnest(res) x where x like 'FAIL%'), E'\n' || array_to_string(res, E'\n');
end $test$;
