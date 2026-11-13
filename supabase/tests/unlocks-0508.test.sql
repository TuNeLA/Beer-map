-- lane unlocks SQL test for 0508 + 0509 (achievements that unlock avatar clothes). Local Postgres copy or STAGING (never
-- live), as the postgres role. One DO block = one transaction; it ENDS WITH AN EXCEPTION on purpose
-- ("UNLOCKS_SQL pass=<n> fail=<m> | …"), so everything is rolled back and nothing stays in the database.
-- On a database without 0508 it stops at the first new function ("function … does not exist") = FAIL.
do $$
declare
  U uuid := gen_random_uuid();   -- Anton: goes out with friends, walks home, plays games
  F uuid := gen_random_uuid();   -- Oskar: a friend
  v_night timestamptz := public.olnu_night_of(now());
  c0 jsonb; c1 jsonb; j jsonb; msg text := ''; pass int := 0; fail int := 0; i int; got text;
  procedure_ok boolean;
begin
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values
    (U, 'authenticated', 'authenticated', true, now(), now()), (F, 'authenticated', 'authenticated', true, now(), now());

  -- 1. Ölpasset: 5 bars (bars_lite gives the place), 2 nights at the first bar
  for i in 1..5 loop
    insert into public.bars_lite (id, name, lat, lng) values ('unl-bar-' || i, 'Bar ' || i, 60.10 + i * 0.001, 15.10) on conflict (id) do nothing;
    insert into public.medal_checkins (user_id, bar_id, night) values (U, 'unl-bar-' || i, v_night);
  end loop;
  insert into public.medal_checkins (user_id, bar_id, night) values (U, 'unl-bar-1', v_night - interval '7 days');
  c0 := public.olnu_unlock_counts(U);
  if (c0->>'pass')::int = 5 and (c0->>'ci')::int = 6 then pass := pass + 1; else fail := fail + 1; msg := msg || ' pass/ci=' || coalesce(c0->>'pass', '-') || '/' || coalesce(c0->>'ci', '-'); end if;

  -- 2. NO achievement counts drinks: 40 beers in every drink table → the counts do not change
  insert into public.medal_nights (user_id, night, beers, others) values (U, v_night, 40, 5) on conflict do nothing;
  begin insert into public.week_beers (user_id, week, n) values (U, public.olnu_week_start(now()), 40); exception when others then null; end;
  begin insert into public.drink_log (user_id, at, night, kind) select U, now(), v_night, 'beer' from generate_series(1, 40); exception when others then null; end;
  c1 := public.olnu_unlock_counts(U);
  if c1 = c0 then pass := pass + 1; else fail := fail + 1; msg := msg || ' beers changed counts'; end if;
  if not exists (select 1 from public.olnu_unlock_medals(U) m where m.n > 0 and m.medal not in ('u_pass5', 'u_ci1')) then pass := pass + 1;
  else fail := fail + 1; msg := msg || ' extra medal from beers'; end if;
  if position('beers' in pg_get_functiondef('public.olnu_unlock_counts(uuid)'::regprocedure)) = 0
     and position('drink_log' in pg_get_functiondef('public.olnu_unlock_counts(uuid)'::regprocedure)) = 0
     and position('olnu_lifetime' in pg_get_functiondef('public.olnu_unlock_counts(uuid)'::regprocedure)) = 0 then pass := pass + 1;
  else fail := fail + 1; msg := msg || ' counts read a drink table'; end if;

  -- 3. medals: u_pass5 yes, u_pass10 no
  if exists (select 1 from public.olnu_unlock_medals(U) m where m.medal = 'u_pass5' and m.n = 1)
     and exists (select 1 from public.olnu_unlock_medals(U) m where m.medal = 'u_pass10' and m.n = 0) then pass := pass + 1;
  else fail := fail + 1; msg := msg || ' pass medals'; end if;

  -- 4. with the gang on Lucia (also counts for Julbordet, 1-24 Dec) + a walk home + 5 party wins + 3 price reports + water on 5 nights
  insert into public.meriter_log (user_id, night, kind, ref, pts) values
    (U, make_timestamptz(2025, 12, 13, 22, 0, 0, 'Europe/Stockholm'), 'squad', 'unl', 1),
    (U, make_timestamptz(2025, 11, 7, 22, 0, 0, 'Europe/Stockholm'), 'squad', 'unl', 1);
  for i in 1..5 loop
    insert into public.meriter_log (user_id, night, kind, ref, pts) values (U, v_night - (i || ' days')::interval, 'water', 'unl', 1);
    insert into public.party_results (room_id, game_no, user_id, game, won, night, players) values (gen_random_uuid(), 1, U, 'quiz', true, v_night, 4);
  end loop;
  insert into public.party_results (room_id, game_no, user_id, game, won, night, players) values (gen_random_uuid(), 1, U, 'quiz', false, v_night, 4);
  insert into public.walks (user_id, ends_at, end_reason) values (U, now(), 'home');
  insert into public.bar_prices (bar_id, user_id, kind, kr, day, bar_lat, bar_lng) values ('unl-bar-1', U, 'stor', 59, current_date, 60.1, 15.1), ('unl-bar-2', U, 'stor', 62, current_date, 60.1, 15.1);
  c1 := public.olnu_unlock_counts(U);
  if (c1->>'gang')::int = 2 and (c1->>'lucia')::int = 1 and (c1->>'jul')::int = 1 and (c1->>'home')::int = 1 and (c1->>'play')::int = 6
     and (c1->>'win')::int = 5 and (c1->>'price')::int = 2 and (c1->>'water')::int = 5 then pass := pass + 1;
  else fail := fail + 1; msg := msg || ' counts=' || c1::text; end if;
  select string_agg(m.medal, ',' order by m.medal) into got from public.olnu_unlock_medals(U) m where m.n > 0;
  if got = 'u_ci1,u_gang1,u_home1,u_jul,u_lucia,u_pass5,u_play1,u_price1,u_water5,u_win5' then pass := pass + 1;
  else fail := fail + 1; msg := msg || ' medals=' || coalesce(got, '-'); end if;

  -- 5. län: two kommuner in two län (stub borders) → lan = 2
  insert into public.olnu_zone_lan (ln, name) values ('unlA', 'Län A'), ('unlB', 'Län B');
  insert into public.olnu_zone_kommun (kn, ln, name) values ('unlk1', 'unlA', 'Test 1'), ('unlk2', 'unlB', 'Test 2');
  insert into public.olnu_zone_poly (kn, bb, poly) values
    ('unlk1', box(point(15.0, 60.0), point(15.2, 60.103)), polygon(box(point(15.0, 60.0), point(15.2, 60.103)))),
    ('unlk2', box(point(15.0, 60.103), point(15.2, 60.2)), polygon(box(point(15.0, 60.103), point(15.2, 60.2))));
  c1 := public.olnu_unlock_counts(U);
  if (c1->>'lan')::int = 2 then pass := pass + 1; else fail := fail + 1; msg := msg || ' lan=' || coalesce(c1->>'lan', '-'); end if;

  -- 6. award_medals path (0509): olnu_medal_store writes the u_* rows
  perform * from public.olnu_medal_store(U);
  if exists (select 1 from public.user_medals um where um.user_id = U and um.medal = 'u_pass5')
     and exists (select 1 from public.user_medals um where um.user_id = U and um.medal = 'u_win5')
     and not exists (select 1 from public.user_medals um where um.user_id = U and um.medal = 'u_pass10') then pass := pass + 1;
  else fail := fail + 1; msg := msg || ' store'; end if;

  -- 7. set_my_avatar: new item open by its medal, locked without; an old item opens by its new path; max checked
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  begin perform public.olnu_avatar_clean(U, '{"v":2,"hw":44}'::jsonb); fail := fail + 1; msg := msg || ' hw44 open without u_pass25';
  exception when others then if sqlerrm = 'locked' then pass := pass + 1; else fail := fail + 1; msg := msg || ' hw44 ' || sqlerrm; end if; end;
  j := public.olnu_avatar_clean(U, '{"v":2,"bg":39,"nk":16,"gl":30}'::jsonb);   -- u_water5, u_home1, u_win5
  if (j->>'bg')::int = 39 and (j->>'nk')::int = 16 and (j->>'gl')::int = 30 then pass := pass + 1; else fail := fail + 1; msg := msg || ' new items ' || j::text; end if;
  j := public.olnu_avatar_clean(U, '{"v":2,"bg":36}'::jsonb);   -- Kartan: old lock b 15 (U has 5), new path u_pass5
  if (j->>'bg')::int = 36 then pass := pass + 1; else fail := fail + 1; msg := msg || ' bg36'; end if;
  begin perform public.olnu_avatar_clean(F, '{"v":2,"bg":36}'::jsonb); fail := fail + 1; msg := msg || ' bg36 open for F';
  exception when others then if sqlerrm = 'locked' then pass := pass + 1; else fail := fail + 1; msg := msg || ' F ' || sqlerrm; end if; end;
  begin perform public.olnu_avatar_clean(U, '{"v":2,"hw":48}'::jsonb); fail := fail + 1; msg := msg || ' hw48 accepted';
  exception when others then if sqlerrm = 'invalid_avatar' then pass := pass + 1; else fail := fail + 1; msg := msg || ' hw48 ' || sqlerrm; end if; end;
  -- an old lock still works on its own (hw:27 r 7 OR u_town2): F has neither → locked
  begin perform public.olnu_avatar_clean(F, '{"v":2,"hw":27}'::jsonb); fail := fail + 1; msg := msg || ' hw27 open for F';
  exception when others then if sqlerrm = 'locked' then pass := pass + 1; else fail := fail + 1; msg := msg || ' hw27 ' || sqlerrm; end if; end;

  -- 8. my_unlock_progress as the user (authenticated)
  perform set_config('role', 'authenticated', true);
  j := public.my_unlock_progress();
  perform set_config('role', 'none', true);
  if (j->>'v')::int = 1 and (j->'c'->>'pass')::int = 5 and (j->'c'->>'win')::int = 5 then pass := pass + 1; else fail := fail + 1; msg := msg || ' progress ' || coalesce(j::text, '-'); end if;
  if not has_function_privilege('anon', 'public.my_unlock_progress()', 'execute')
     and not has_function_privilege('authenticated', 'public.olnu_unlock_counts(uuid)', 'execute') then pass := pass + 1;
  else fail := fail + 1; msg := msg || ' grants'; end if;

  raise exception 'UNLOCKS_SQL pass=% fail=% |%', pass, fail, msg;
end $$;
