-- Local tests for 0026 v19 GÄNGET. Run on a scratch database that has setup.sql + 0024 + 0025 + 0026:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/gang.test.sql
-- Everything runs inside one transaction that is rolled back at the end (no rows stay).
begin;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, true);
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end; $$;
create or replace function pg_temp.eq(a anyelement, b anyelement, msg text) returns void language plpgsql as $$
begin
  if a is distinct from b then raise exception 'FAIL %: got % expected %', msg, a, b; end if;
  raise notice 'ok  %', msg;
end; $$;

do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000000a';
  ub uuid := '00000000-0000-4000-8000-00000000000b';
  uc uuid := '00000000-0000-4000-8000-00000000000c';
  ux uuid := '00000000-0000-4000-8000-0000000000ff';   -- not a member
  g uuid; g2 uuid; code text;
  j jsonb; k_a text; k_b text; k_c text; v bigint; v2 bigint; n int;
  msg bigint;
begin
  -- Group with A, B, C
  perform pg_temp.as_user(ua);
  j := public.create_group('Kapsylkommandot', 'Anton')::jsonb; g := (j ->> 'id')::uuid; code := j ->> 'code';
  perform pg_temp.as_user(ub); perform public.join_group(code, 'Oskar');
  perform pg_temp.as_user(uc); perform public.join_group(code, 'Lisa');
  perform pg_temp.as_user(ux);
  j := public.create_group('Andra', 'Xerxes')::jsonb; g2 := (j ->> 'id')::uuid;

  -- members / keys
  perform pg_temp.as_user(ua);
  j := public.gang_group(g);
  perform pg_temp.eq(jsonb_array_length(j -> 'members'), 3, 'gang_group: 3 members');
  perform pg_temp.eq((j -> 'members' -> 0 ->> 'is_me')::boolean, true, 'gang_group: me first');
  select x ->> 'k' into k_a from jsonb_array_elements(j -> 'members') x where x ->> 'name' = 'Anton';
  select x ->> 'k' into k_b from jsonb_array_elements(j -> 'members') x where x ->> 'name' = 'Oskar';
  select x ->> 'k' into k_c from jsonb_array_elements(j -> 'members') x where x ->> 'name' = 'Lisa';
  perform pg_temp.eq(length(k_a), 12, 'member key 12 hex');
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.gang_group(%L)', g)), 'not_member', 'gang_group: outsider -> not_member');

  -- ===== 1. Citatboken =====
  perform pg_temp.as_user(ua);
  j := public.add_quote(g, 'Oskar', ' "Jag ä int'' full, jag ä bara glad." ');
  perform pg_temp.eq(j ->> 'body', 'Jag ä int'' full, jag ä bara glad.', 'quote: trimmed + quotes stripped');
  perform pg_temp.eq((j ->> 'reveal_at')::timestamptz, public.olnu_gang_reveal(public.olnu_night_of(now())), 'quote: reveal_at = 10:00 after the night');
  perform pg_temp.eq(pg_temp.err(format('select public.add_quote(%L, %L, %L)', g, 'Oskar', 'igen')), 'slow_down', 'quote: 8 s rate limit');
  perform pg_temp.eq(pg_temp.err(format('select public.add_quote(%L, %L, %L)', g, '', 'x')), 'invalid_quote', 'quote: empty who');
  perform pg_temp.eq(pg_temp.err(format('select public.add_quote(%L, %L, %L)', g, 'O', repeat('x', 141))), 'invalid_quote', 'quote: 141 chars');
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.add_quote(%L, %L, %L)', g, 'O', 'x')), 'not_member', 'quote: outsider');
  -- B sees nothing yet (hidden until 10:00), A sees own pending
  perform pg_temp.as_user(ub);
  select count(*) into n from public.gang_quotes(g);
  perform pg_temp.eq(n, 0, 'quote: hidden for others before reveal');
  perform pg_temp.eq((public.gang_group(g) -> 'quotes' ->> 'pending')::int, 1, 'quote: pending count 1');
  perform pg_temp.as_user(ua);
  select count(*) into n from public.gang_quotes(g) q where not q.revealed and q.by_me;
  perform pg_temp.eq(n, 1, 'quote: saver sees own pending');
  -- from a chat message: who/body come from the message
  perform pg_temp.as_user(uc);
  msg := (public.post_group_msg(g, 'Kebab ä en näringsdryck')::jsonb ->> 'id')::bigint;
  perform pg_temp.as_user(ub);
  j := public.add_quote(g, 'Fel Namn', 'fel text', msg);
  perform pg_temp.eq(j ->> 'who', 'Lisa', 'quote from chat: who = sender');
  perform pg_temp.eq(j ->> 'body', 'Kebab ä en näringsdryck', 'quote from chat: body = message');
  v := (j ->> 'id')::bigint;
  -- reveal: move both quotes to last night (reveal 10:00 today)
  reset role;
  update public.gang_quotes set night = public.olnu_gang_last_night(), reveal_at = now() - interval '1 minute' where group_id = g;
  perform pg_temp.as_user(uc);
  select count(*) into n from public.gang_quotes(g);
  perform pg_temp.eq(n, 2, 'quote: revealed for everyone after 10:00');
  perform pg_temp.eq(jsonb_array_length(public.gang_group(g) -> 'quotes' -> 'yesterday'), 2, 'quote: Gårdagens citat card has 2');
  -- hide: only saver or quoted person
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(pg_temp.err(format('select public.hide_quote(%s)', v)), 'not_yours', 'hide: other member refused');
  perform pg_temp.as_user(uc);   -- Lisa is quoted
  perform public.hide_quote(v);
  select count(*) into n from public.gang_quotes(g);
  perform pg_temp.eq(n, 1, 'hide: quoted person hid it');
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.hide_quote(%s)', v)), 'quote_not_found', 'hide: outsider');

  -- reveal time rule, DST (night 2026-10-25 05:00 CET after the clock change)
  perform pg_temp.eq(public.olnu_gang_reveal('2026-10-25 05:00+01'::timestamptz), '2026-10-25 10:00+01'::timestamptz, 'reveal DST end');
  perform pg_temp.eq(public.olnu_gang_reveal('2027-03-28 05:00+02'::timestamptz), '2027-03-28 10:00+02'::timestamptz, 'reveal DST start');
  perform pg_temp.eq(public.olnu_gang_reveal('2026-10-18 05:00+02'::timestamptz), '2026-10-18 10:00+02'::timestamptz, 'reveal normal');

  -- ===== 2. Mest troligt =====
  perform pg_temp.as_user(ua);
  j := public.mt_start(g, 120); v := (j ->> 'id')::bigint;
  perform pg_temp.eq(((j ->> 'q')::int between 0 and 119), true, 'mt: q in range');
  perform pg_temp.as_user(ub);
  perform pg_temp.eq(pg_temp.err(format('select public.mt_start(%L, 120)', g)), 'round_open', 'mt: one round at a time');
  j := public.mt_vote(v, k_a);
  perform pg_temp.eq((j ->> 'votes')::int, 1, 'mt: vote counted');
  perform pg_temp.eq(j -> 'results', 'null'::jsonb, 'mt: results hidden while open');
  j := public.mt_vote(v, k_c);   -- change
  perform pg_temp.eq((j ->> 'votes')::int, 1, 'mt: changed vote still 1');
  perform pg_temp.eq(j ->> 'my_vote', k_c, 'mt: my_vote = changed');
  perform pg_temp.eq(pg_temp.err(format('select public.mt_vote(%s, %L)', v, 'nope')), 'invalid_member', 'mt: bad key');
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.mt_vote(%s, %L)', v, k_a)), 'round_not_found', 'mt: outsider');
  perform pg_temp.as_user(ua); perform public.mt_vote(v, k_c);
  perform pg_temp.as_user(uc); j := public.mt_vote(v, k_c);
  perform pg_temp.eq((j ->> 'done')::boolean, true, 'mt: all voted -> done');
  perform pg_temp.eq(j -> 'results' -> 0 ->> 'name', 'Lisa', 'mt: winner Lisa');
  perform pg_temp.eq((j -> 'results' -> 0 ->> 'n')::int, 3, 'mt: winner 3 votes');
  perform pg_temp.eq(pg_temp.err(format('select public.mt_vote(%s, %L)', v, k_a)), 'round_done', 'mt: no votes after done');
  -- new round allowed now; starter closes it; rate limit for same starter
  j := public.mt_start(g, 120); v2 := (j ->> 'id')::bigint;
  perform pg_temp.eq(pg_temp.err(format('select public.mt_close(%s)', v2)) <> 'ok', false, 'mt: starter closes');
  perform pg_temp.eq(pg_temp.err(format('select public.mt_start(%L, 120)', g)), 'slow_down', 'mt: 15 s per starter');
  perform pg_temp.as_user(ub);
  perform pg_temp.eq(pg_temp.err(format('select public.mt_close(%s)', v)), 'round_not_found', 'mt: only starter closes');
  perform pg_temp.eq(jsonb_array_length(public.gang_group(g) -> 'mt' -> 'history'), 2, 'mt: history tonight 2');
  -- 10 min timeout
  j := public.mt_start(g, 120); v := (j ->> 'id')::bigint;
  reset role; update public.gang_mt_rounds set ends_at = now() - interval '1 second' where id = v;
  perform pg_temp.as_user(ub);
  perform pg_temp.eq((public.gang_group(g) -> 'mt' -> 'round' ->> 'done')::boolean, true, 'mt: round done after 10 min');
  -- small group
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.mt_start(%L, 120)', g2)), 'not_enough', 'mt: 1-member group');

  -- ===== 3. Vart ska vi? =====
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(pg_temp.err(format('select public.create_bar_poll(%L, %L)', g, '[{"id":"a","name":"A","lat":60.1,"lng":15.1}]')), 'invalid_poll', 'poll: 1 option');
  perform pg_temp.eq(pg_temp.err(format('select public.create_bar_poll(%L, %L)', g, '[{"id":"a","name":"A","lat":60.1,"lng":15.1},{"id":"a","name":"A2","lat":60.1,"lng":15.1}]')), 'invalid_poll', 'poll: duplicate id');
  perform pg_temp.eq(pg_temp.err(format('select public.create_bar_poll(%L, %L)', g, '[{"id":"a","name":"A","lat":99,"lng":15.1},{"id":"b","name":"B","lat":60.1,"lng":15.1}]')), 'invalid_poll', 'poll: bad lat');
  j := public.create_bar_poll(g, '[{"id":"n1","name":"Pitchers","lat":60.14961,"lng":15.18781},{"id":"n2","name":"Bishops","lat":60.15,"lng":15.19},{"id":"n3","name":"La Parma","lat":60.151,"lng":15.191}]');
  v := (j ->> 'id')::bigint;
  perform pg_temp.as_user(ub);
  perform pg_temp.eq(pg_temp.err(format('select public.create_bar_poll(%L, %L)', g, '[{"id":"a","name":"A","lat":60.1,"lng":15.1},{"id":"b","name":"B","lat":60.1,"lng":15.1}]')), 'poll_open', 'poll: one open per group');
  j := public.vote_bar_poll(v, 1);
  perform pg_temp.eq((j -> 'options' -> 1 ->> 'n')::int, 1, 'poll: vote live count');
  perform pg_temp.eq(pg_temp.err(format('select public.vote_bar_poll(%s, 3)', v)), 'invalid_option', 'poll: option out of range');
  perform pg_temp.eq(pg_temp.err(format('select public.end_bar_poll(%s)', v)), 'not_yours', 'poll: only creator ends early');
  perform pg_temp.as_user(uc); perform public.vote_bar_poll(v, 1);
  perform pg_temp.as_user(ua); perform public.vote_bar_poll(v, 0);
  j := public.end_bar_poll(v);
  perform pg_temp.eq((j ->> 'winner')::int, 1, 'poll: winner Bishops (2 votes)');
  perform pg_temp.eq(j ->> 'rally_id' is not null, true, 'poll: call-out made');
  reset role;
  perform pg_temp.eq((select r.place from public.rallies r where r.id = (j ->> 'rally_id')::bigint), 'Bishops', 'poll: rally place');
  perform pg_temp.eq((select r.lat from public.rallies r where r.id = (j ->> 'rally_id')::bigint), 60.15::float8, 'poll: rally lat');
  perform pg_temp.eq((select r.user_id from public.rallies r where r.id = (j ->> 'rally_id')::bigint), ua, 'poll: rally by the ender');
  perform pg_temp.as_user(ua);
  j := public.end_bar_poll(v);   -- idempotent
  perform pg_temp.eq((j ->> 'winner')::int, 1, 'poll: end twice ok');
  perform pg_temp.eq(pg_temp.err(format('select public.vote_bar_poll(%s, 0)', v)), 'poll_ended', 'poll: no votes after end');
  -- auto end after 15 min via gang_group, by another member; tie -> first to reach the count
  perform pg_temp.as_user(ub);
  j := public.create_bar_poll(g, '[{"id":"n1","name":"Pitchers","lat":60.14961,"lng":15.18781},{"id":"n2","name":"Bishops","lat":60.15,"lng":15.19}]');
  v := (j ->> 'id')::bigint;
  perform public.vote_bar_poll(v, 0);
  perform pg_temp.as_user(uc); perform public.vote_bar_poll(v, 1);
  reset role;
  update public.gang_poll_votes set updated_at = now() - interval '5 minutes' where poll_id = v and opt = 0;
  update public.gang_polls set ends_at = now() - interval '1 second' where id = v;
  perform pg_temp.as_user(uc);
  j := public.gang_group(g) -> 'poll';
  perform pg_temp.eq((j ->> 'ended')::boolean, true, 'poll: auto-ended after 15 min');
  perform pg_temp.eq((j ->> 'winner')::int, 0, 'poll: tie -> first to reach');
  perform pg_temp.eq(j ->> 'rally_id' is not null, true, 'poll: auto call-out by viewer');
  -- no votes -> no winner, no rally
  perform pg_temp.as_user(ux);
  perform public.join_group(code, 'Xerxes');
  j := public.create_bar_poll(g, '[{"id":"n1","name":"P","lat":60.1,"lng":15.1},{"id":"n2","name":"B","lat":60.1,"lng":15.2}]');
  j := public.end_bar_poll((j ->> 'id')::bigint);
  perform pg_temp.eq(j -> 'winner', 'null'::jsonb, 'poll: no votes -> no winner');
  perform pg_temp.eq(j -> 'rally_id', 'null'::jsonb, 'poll: no votes -> no rally');
  perform public.leave_group(g);
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.create_bar_poll(%L, %L)', g, '[{"id":"a","name":"A","lat":60.1,"lng":15.1},{"id":"b","name":"B","lat":60.1,"lng":15.1}]')), 'not_member', 'poll: outsider');

  -- ===== 4. Bakisbrunchen (hour forced) =====
  reset role;
  execute 'create or replace function public.olnu_gang_hour() returns int language sql stable set search_path = public as $f$ select 3 $f$';
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(pg_temp.err(format('select public.create_brunch(%L, %L)', g, 'Café Sten')), 'not_morning', 'brunch: 03:00 refused');
  reset role;
  execute 'create or replace function public.olnu_gang_hour() returns int language sql stable set search_path = public as $f$ select 10 $f$';
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(pg_temp.err(format('select public.create_brunch(%L, %L, null, null, null, %L)', g, 'Café Sten', '25:00')), 'invalid_brunch', 'brunch: bad time');
  j := public.create_brunch(g, 'Café Sten', 'pl_6014961_1518781', 60.14961, 15.18781, '11:30'); v := (j ->> 'id')::bigint;
  perform pg_temp.as_user(ub);
  perform pg_temp.eq(pg_temp.err(format('select public.create_brunch(%L, %L)', g, 'Annat')), 'brunch_open', 'brunch: one per group');
  j := public.answer_brunch(v, 'Kanske');
  perform pg_temp.eq(j ->> 'mine', 'kanske', 'brunch: answer lower-cased');
  perform pg_temp.eq(j -> 'ja' ->> 0, 'Anton', 'brunch: creator says ja');
  perform pg_temp.eq(pg_temp.err(format('select public.answer_brunch(%s, %L)', v, 'kanske?')), 'invalid_answer', 'brunch: bad answer');
  perform pg_temp.as_user(uc); j := public.answer_brunch(v, 'nej');
  perform pg_temp.eq(jsonb_array_length(j -> 'nej'), 1, 'brunch: nej list');
  perform pg_temp.eq(pg_temp.err(format('select public.close_brunch(%s)', v)), 'brunch_not_found', 'brunch: only creator closes');
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(pg_temp.err(format('select public.create_brunch(%L, %L)', g, 'Igen')), 'slow_down', 'brunch: 2 min per user');
  perform public.close_brunch(v);
  perform pg_temp.eq(public.gang_group(g) -> 'brunch', 'null'::jsonb, 'brunch: closed hides it');
  reset role;
  execute 'create or replace function public.olnu_gang_hour() returns int language sql stable set search_path = public as $f$ select extract(hour from (now() at time zone ''Europe/Stockholm''))::int $f$';

  -- ===== 5. Kebabtoppen =====
  reset role;
  insert into public.bars_lite (id, name, lat, lng, type) values
    ('pl_6814961_1880781', 'Kebabkungen Testby', 68.14961, 18.80781, 'fast_food'),
    ('pl_6814971_1880791', 'Pizzeria Test', 68.14971, 18.80791, 'restaurant'),
    ('ntestpub1', 'Testpuben', 68.1498, 18.808, 'pub')
  on conflict (id) do nothing;
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(pg_temp.err('select public.rate_kebab(''ntestpub1'', ''Testpuben'', 68.1498, 18.808, 5, null, 68.1498, 18.808)'), 'not_food', 'kebab: pub refused');
  perform pg_temp.eq(pg_temp.err('select public.rate_kebab(''pl_6814961_1880781'', ''K'', 68.14961, 18.80781, 6, null, 68.1498, 18.808)'), 'invalid_stars', 'kebab: 6 stars');
  perform pg_temp.eq(pg_temp.err('select public.rate_kebab(''pl_6814961_1880781'', ''K'', 68.14961, 18.80781, 5, ''billig_öl'', 68.1498, 18.808)'), 'invalid_tag', 'kebab: tag whitelist');
  perform pg_temp.eq(pg_temp.err('select public.rate_kebab(''pl_6814961_1880781'', ''K'', 68.14961, 18.80781, 5, null, 68.30, 18.808)'), 'too_far', 'kebab: too far');
  perform pg_temp.eq(pg_temp.err('select public.rate_kebab(''pl_6814961_1880781'', ''K'', 68.14961, 18.80781, 5, null, null, null)'), 'too_far', 'kebab: no position');
  j := public.rate_kebab('pl_6814961_1880781', 'fel namn', 1, 1, 5, 'sas', 68.1498, 18.808);
  perform pg_temp.eq((j ->> 'is_new')::boolean, true, 'kebab: new rating');
  perform pg_temp.eq(pg_temp.err('select public.rate_kebab(''pl_6814961_1880781'', ''K'', 68.14961, 18.80781, 3, null, 68.1498, 18.808)'), 'slow_down', 'kebab: 5 s');
  reset role; update public.kebab_ratings set updated_at = now() - interval '1 minute' where user_id = ua;
  perform pg_temp.as_user(ua);
  j := public.rate_kebab('pl_6814961_1880781', 'K', 68.14961, 18.80781, 4, 'sas', 68.1498, 18.808);
  perform pg_temp.eq((j ->> 'is_new')::boolean, false, 'kebab: same night = change');
  perform pg_temp.eq((j ->> 'n')::int, 1, 'kebab: still one vote');
  perform pg_temp.as_user(ub);
  perform public.rate_kebab('pl_6814961_1880781', 'K', 68.14961, 18.80781, 5, 'storst', 68.1498, 18.808);
  reset role; update public.kebab_ratings set updated_at = now() - interval '1 minute' where user_id = ub;
  perform pg_temp.as_user(ub);
  perform public.rate_kebab('pl_6814971_1880791', 'P', 68.14971, 18.80791, 2, null, 68.1498, 18.808);
  -- not in bars_lite: "pl_" id accepted (worldwide tiles); other ids refused
  perform pg_temp.as_user(uc);
  perform pg_temp.eq(pg_temp.err('select public.rate_kebab(''w12345'', ''X'', 68.1498, 18.808, 3, null, 68.1498, 18.808)'), 'not_food', 'kebab: unknown non-place id');
  j := public.rate_kebab('pl_6814000_1880000', 'Gatukök Utanför', 68.14, 18.80, 3, null, 68.1498, 18.808);
  perform pg_temp.eq((j ->> 'ok')::boolean, true, 'kebab: pl_ id outside bars_lite ok');
  j := public.kebab_top(68.1498, 18.808);
  perform pg_temp.eq(j -> 'list' -> 0 ->> 'name', 'Kebabkungen Testby', 'kebab top: #1 name from bars_lite');
  perform pg_temp.eq((j -> 'list' -> 0 ->> 'avg')::numeric, 4.5, 'kebab top: avg 4.5');
  perform pg_temp.eq((j -> 'list' -> 0 ->> 'n')::int, 2, 'kebab top: 2 votes');
  perform pg_temp.eq(jsonb_array_length(j -> 'list'), 3, 'kebab top: 3 places');
  perform pg_temp.eq(j -> 'town', 'null'::jsonb, 'kebab top: no town far north -> null (cell)');
  j := public.kebab_place('pl_6814961_1880781');
  perform pg_temp.eq((j ->> 'n')::int, 2, 'kebab place: n');
  perform pg_temp.as_user(ua);
  perform pg_temp.eq((public.kebab_place('pl_6814961_1880781') ->> 'my_stars')::int, 4, 'kebab place: my stars');
  perform pg_temp.eq((public.kebab_place('pl_6814961_1880781') ->> 'rated_tonight')::boolean, true, 'kebab place: rated tonight');
  perform pg_temp.eq(public.kebab_top(60.1496, 15.1878) ->> 'town', 'Ludvika', 'kebab top: Ludvika town key');

  -- ===== 6. Skuldboken =====
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(pg_temp.err(format('select public.add_debt(%L, %L, %L, 85, %L)', g, k_b, k_b, 'pizza')), 'invalid_debt', 'debt: same person');
  perform pg_temp.eq(pg_temp.err(format('select public.add_debt(%L, %L, %L, 0, %L)', g, k_b, k_a, 'pizza')), 'invalid_debt', 'debt: 0 kr');
  perform pg_temp.eq(pg_temp.err(format('select public.add_debt(%L, %L, %L, 85, %L)', g, k_b, k_a, '')), 'invalid_debt', 'debt: no text');
  perform pg_temp.eq(pg_temp.err(format('select public.add_debt(%L, %L, %L, 85, %L)', g, 'nope', k_a, 'x')), 'invalid_debt', 'debt: bad key');
  v := (public.add_debt(g, k_b, k_a, 85, 'pizzan') ->> 'id')::bigint;           -- Oskar owes Anton 85
  perform pg_temp.eq(pg_temp.err(format('select public.add_debt(%L, %L, %L, 10, %L)', g, k_c, k_a, 'x')), 'slow_down', 'debt: 3 s');
  perform pg_temp.as_user(uc);
  perform public.add_debt(g, k_a, k_c, 50, 'taxi');                               -- Anton owes Lisa 50
  reset role; update public.gang_debts set created_at = now() - interval '1 minute';
  perform pg_temp.as_user(uc);
  v2 := (public.add_debt(g, k_b, k_c, 35, 'kebab') ->> 'id')::bigint;           -- Oskar owes Lisa 35
  j := public.gang_group(g) -> 'debts';
  perform pg_temp.eq(jsonb_array_length(j -> 'open'), 3, 'debt: 3 open');
  select (x ->> 'net')::int into n from jsonb_array_elements(j -> 'net') x where x ->> 'name' = 'Anton';
  perform pg_temp.eq(n, 35, 'debt: Anton net +35');
  select (x ->> 'net')::int into n from jsonb_array_elements(j -> 'net') x where x ->> 'name' = 'Oskar';
  perform pg_temp.eq(n, -120, 'debt: Oskar net -120');
  select (x ->> 'net')::int into n from jsonb_array_elements(j -> 'net') x where x ->> 'name' = 'Lisa';
  perform pg_temp.eq(n, 85, 'debt: Lisa net +85');
  perform pg_temp.as_user(ub);
  perform pg_temp.eq((public.gang_poll() -> 'groups' -> 0 ->> 'debt_net')::int, -120, 'debt: gang_poll my net');
  perform pg_temp.eq(pg_temp.err(format('select public.settle_debt(%s, %L)', v, 'cancel')), 'not_yours', 'debt: debtor cannot cancel');
  perform public.settle_debt(v, 'paid');                                          -- Oskar paid Anton
  j := public.gang_group(g) -> 'debts';
  select (x ->> 'net')::int into n from jsonb_array_elements(j -> 'net') x where x ->> 'name' = 'Oskar';
  perform pg_temp.eq(n, -35, 'debt: after paid Oskar -35');
  perform pg_temp.eq(jsonb_array_length(j -> 'paid'), 1, 'debt: paid list');
  perform public.settle_debt(v, 'unpaid');
  select (x ->> 'net')::int into n from jsonb_array_elements(public.gang_group(g) -> 'debts' -> 'net') x where x ->> 'name' = 'Oskar';
  perform pg_temp.eq(n, -120, 'debt: unpaid undo');
  perform pg_temp.as_user(uc);
  perform public.settle_debt(v2, 'cancel');
  perform pg_temp.eq(pg_temp.err(format('select public.settle_debt(%s, %L)', v2, 'paid')), 'debt_not_found', 'debt: cancelled is gone');
  perform pg_temp.eq(pg_temp.err(format('select public.settle_debt(%s, %L)', v, 'betala')), 'invalid_action', 'debt: bad action');
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.settle_debt(%s, %L)', v, 'paid')), 'debt_not_found', 'debt: outsider');
  -- Swish
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(public.set_swish(g, '+46 70-123 45 67') ->> 'number', '0701234567', 'swish: +46 normalised');
  perform pg_temp.eq(pg_temp.err(format('select public.set_swish(%L, %L)', g, '08123456')), 'invalid_swish', 'swish: landline refused');
  perform pg_temp.eq(pg_temp.err(format('select public.set_swish(%L, %L)', g, '07012345')), 'invalid_swish', 'swish: too short');
  perform pg_temp.as_user(ub);
  perform pg_temp.eq(public.gang_group(g) -> 'debts' -> 'swish' -> 0 ->> 'number', '0701234567', 'swish: visible to member');
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.set_swish(%L, %L)', g, '0701234567')), 'not_member', 'swish: outsider');
  perform pg_temp.as_user(ua);
  perform pg_temp.eq(public.set_swish(g, '') -> 'number', 'null'::jsonb, 'swish: cleared');

  -- ===== 7. Morgontidningen =====
  reset role;
  insert into public.medal_nights (user_id, night, beers, others, first_at, home)
  values (ua, public.olnu_gang_last_night(), 4, 0, public.olnu_gang_last_night() - interval '7 hours', false),
         (ub, public.olnu_gang_last_night(), 2, 1, public.olnu_gang_last_night() - interval '6 hours', true)
  on conflict do nothing;
  insert into public.medal_checkins (user_id, bar_id, night) values
    (ua, 'pl_6814961_1880781', public.olnu_gang_last_night()), (ua, 'ntestpub1', public.olnu_gang_last_night())
  on conflict do nothing;
  insert into public.after_nights (user_id, night, town, out, skal_given, home_at)
  values (ub, public.olnu_gang_last_night(), 'Ludvika', true, 7, public.olnu_gang_last_night() - interval '3 hours')
  on conflict do nothing;
  perform pg_temp.as_user(uc);
  j := public.gang_paper(g);
  perform pg_temp.eq((j ->> 'out_n')::int, 2, 'paper: 2 out');
  perform pg_temp.eq((j ->> 'ready')::boolean, true, 'paper: ready');
  perform pg_temp.eq(j ->> 'town', 'Ludvika', 'paper: town');
  select (x ->> 'bars')::int into n from jsonb_array_elements(j -> 'members') x where x ->> 'name' = 'Anton';
  perform pg_temp.eq(n, 2, 'paper: Anton 2 bars');
  select (x ->> 'skal')::int into n from jsonb_array_elements(j -> 'members') x where x ->> 'name' = 'Oskar';
  perform pg_temp.eq(n, 7, 'paper: Oskar skål 7');
  perform pg_temp.eq((select count(*) from jsonb_array_elements(j -> 'members') x where x ? 'beers' or x ? 'drinks')::int, 0, 'paper: no drink counts');
  perform pg_temp.eq(jsonb_array_length(j -> 'quotes'), 1, 'paper: 1 visible quote (one hidden)');
  perform pg_temp.eq((public.gang_poll() -> 'groups' -> 0 ->> 'paper')::boolean, true, 'gang_poll: paper flag');
  perform pg_temp.as_user(ux);
  perform pg_temp.eq(pg_temp.err(format('select public.gang_paper(%L)', g)), 'not_member', 'paper: outsider');

  -- ===== gang_poll summary =====
  perform pg_temp.as_user(ua);
  j := public.gang_poll();
  perform pg_temp.eq(jsonb_array_length(j -> 'groups'), 1, 'gang_poll: 1 group');
  perform pg_temp.eq(j -> 'groups' -> 0 ->> 'name', 'Kapsylkommandot', 'gang_poll: name');

  -- not authenticated
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.eq(pg_temp.err('select public.gang_poll()'), 'not_authenticated', 'no session -> not_authenticated');
  raise notice 'ALL GANG TESTS PASSED';
end $$;

-- Grants: anon cannot call, authenticated can.
set local role anon;
select pg_temp.err('select public.gang_poll()') as anon_call;
reset role;
set local role authenticated;
select pg_temp.err('select public.gang_poll()') as authenticated_call;
reset role;
rollback;
