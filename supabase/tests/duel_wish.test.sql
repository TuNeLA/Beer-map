-- 0031 server test (wishes + duels). Runs as one DO block and ends with RAISE ALLPASS, so everything rolls back.
-- Fake user ids via request.jwt.claims; test groups only; post_beer_v2 at lat 68.35, lng 18.80.
do $t$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); u4 uuid := gen_random_uuid();
  ga json; gb json; gc json; tok jsonb; d jsonb; p jsonb; r jsonb; did bigint; did2 bigint;
  log text := ''; ok boolean; e text;
  procedure_dummy int;
begin
  -- helper: act as user
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  ga := public.create_group('ZZTest A', 'Anna');
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  gb := public.create_group('ZZTest B', 'Bo');
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  gc := public.create_group('ZZTest C', 'Cia');
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform public.join_group(ga->>'code', 'Dubbel');
  perform public.join_group(gb->>'code', 'Dubbel');

  -- QR flow
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  tok := public.duel_invite((ga->>'id')::uuid);
  log := log || 'token=' || (tok->>'token') || '; ';
  if (public.duel_invite((ga->>'id')::uuid))->>'token' <> tok->>'token' then raise exception 'FAIL token reuse'; end if;
  begin perform public.duel_accept_token(tok->>'token', (ga->>'id')::uuid); raise exception 'FAIL same_group';
  exception when others then if sqlerrm <> 'same_group' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := public.duel_token_info(tok->>'token');
  if r->>'group_name' <> 'ZZTest A' then raise exception 'FAIL info %', r; end if;
  d := public.duel_accept_token(tok->>'token', (gb->>'id')::uuid);
  did := (d->>'id')::bigint;
  if d->>'status' <> 'active' or (d->'us'->>'members')::int <> 1 or (d->'them'->>'members')::int <> 1 then raise exception 'FAIL accept %', d; end if;
  log := log || 'accept ok us.members=1 (dual excluded); ';
  r := public.duel_accept_token(tok->>'token', (gb->>'id')::uuid);
  if (r->>'already')::boolean is not true then raise exception 'FAIL already %', r; end if;

  -- drinks: real post via trigger for u1 and u2, extra log rows
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform public.post_beer_v2(68.35, 18.80, false, false);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform public.post_beer_v2(68.35, 18.80, false, false);
  if (select count(*) from public.duel_log where user_id in (u1,u2) and kind='drink') <> 2 then raise exception 'FAIL trigger log'; end if;
  insert into public.duel_log (user_id, kind, n) values (u2,'drink',1),(u2,'drink',1),(u3,'drink',1),(u3,'drink',1),(u3,'drink',1),(u1,'skal',1),(u1,'checkin',1);
  d := public.olnu_duel_json(did, u2);
  if (d->'us'->>'drinks')::int <> 3 or (d->'them'->>'drinks')::int <> 1 then raise exception 'FAIL score %', d; end if;
  if (d->'them'->>'spirit')::int <> 4 then raise exception 'FAIL spirit %', d; end if;
  log := log || 'score B3 A1, spirit A4; ';

  -- dual member must pick
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  p := public.duel_poll();
  d := p->'duels'->0;
  if (d->>'needs_pick')::boolean is not true or (d->>'both')::boolean is not true then raise exception 'FAIL needs_pick %', d; end if;
  if (d->'us'->>'undecided')::int <> 1 then raise exception 'FAIL undecided %', d; end if;
  d := public.duel_pick_side(did, (gb->>'id')::uuid);
  if (d->'us'->>'drinks')::int <> 6 or d->'group'->>'name' <> 'ZZTest B' or (d->'pick'->>'can_switch')::boolean is not true then raise exception 'FAIL pick B %', d; end if;
  if (public.olnu_duel_json(did, u1)->'us'->>'drinks')::int <> 1 then raise exception 'FAIL A after pick'; end if;
  d := public.duel_pick_side(did, (ga->>'id')::uuid);
  if (d->'us'->>'drinks')::int <> 4 or (d->'them'->>'drinks')::int <> 3 or (d->'pick'->>'can_switch')::boolean then raise exception 'FAIL switch %', d; end if;
  begin perform public.duel_pick_side(did, (gb->>'id')::uuid); raise exception 'FAIL lock';
  exception when others then if sqlerrm <> 'side_locked' then raise; end if; end;
  log := log || 'pick/switch/lock ok; ';
  -- 10-minute window: a fresh pick older than 10 min is locked
  update public.duel_sides set changes = 0, first_at = now() - interval '11 minutes' where duel_id = did and user_id = u3;
  begin perform public.duel_pick_side(did, (gb->>'id')::uuid); raise exception 'FAIL lock10';
  exception when others then if sqlerrm <> 'side_locked' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  begin perform public.duel_pick_side(did, (gb->>'id')::uuid); raise exception 'FAIL not_both';
  exception when others then if sqlerrm <> 'not_both' then raise; end if; end;

  -- code challenge (pending) C -> A, accept by A member
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  d := public.duel_challenge((gc->>'id')::uuid, ga->>'code', null);
  did2 := (d->>'id')::bigint;
  if d->>'status' <> 'pending' or (d->>'outgoing')::boolean is not true then raise exception 'FAIL challenge %', d; end if;
  begin perform public.duel_challenge((gc->>'id')::uuid, ga->>'code', null); raise exception 'FAIL dup';
  exception when others then if sqlerrm <> 'already_dueling' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  p := public.duel_poll();
  if jsonb_array_length(p->'duels') <> 2 then raise exception 'FAIL poll count %', p; end if;
  if not exists (select 1 from jsonb_array_elements(p->'duels') x where (x->>'incoming')::boolean) then raise exception 'FAIL incoming'; end if;
  d := public.duel_answer(did2, true);
  if d->>'status' <> 'active' then raise exception 'FAIL answer %', d; end if;
  log := log || 'code challenge+accept ok; ';

  -- nearby
  perform public.duel_set_open((ga->>'id')::uuid, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  r := public.duel_nearby((gc->>'id')::uuid, 68.35, 18.80);
  log := log || 'nearby(C, A already dueling)=' || jsonb_array_length(r->'groups') || '; ';

  -- finish
  update public.duels set accepted_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where id = did;
  update public.duel_log set at = now() - interval '10 seconds' where user_id in (u1,u2,u3);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  p := public.duel_poll();
  select x into d from jsonb_array_elements(p->'duels') x where (x->>'id')::bigint = did;
  if d->>'status' <> 'done' or d->>'winner' <> 'them' then raise exception 'FAIL finish %', d; end if;
  log := log || 'finish winner A (4 vs 3) ok, wins=' || (d->'opp'->>'wins') || '; ';

  -- wishes
  r := public.submit_wish('Testönskan nummer ett', 'kartan', 'Bo');
  if (r->>'votes')::int <> 1 then raise exception 'FAIL wish %', r; end if;
  begin perform public.submit_wish('Andra', null, null); raise exception 'FAIL 15s';
  exception when others then if sqlerrm <> 'slow_down' then raise; end if; end;
  begin perform public.submit_wish('kolla www.x.se', null, null); raise exception 'FAIL link';
  exception when others then if sqlerrm <> 'invalid_wish' then raise; end if; end;
  update public.feature_wishes set created_at = now() - interval '1 minute' where user_id = u2;
  perform public.submit_wish('Testönskan två', null, null);
  update public.feature_wishes set created_at = now() - interval '1 minute' where user_id = u2;
  perform public.submit_wish('Testönskan tre', null, null);
  update public.feature_wishes set created_at = now() - interval '1 minute' where user_id = u2;
  perform public.submit_wish('Testönskan fyra', null, null);
  update public.feature_wishes set created_at = now() - interval '1 minute' where user_id = u2;
  r := public.submit_wish('Testönskan fem', null, null);
  if (r->>'left_today')::int <> 0 then raise exception 'FAIL left %', r; end if;
  update public.feature_wishes set created_at = now() - interval '1 minute' where user_id = u2;
  begin perform public.submit_wish('Testönskan sex', null, null); raise exception 'FAIL 5/day';
  exception when others then if sqlerrm <> 'slow_down' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  r := public.submit_wish('testönskan NUMMER ett', null, null);
  if (r->>'dup')::boolean is not true or (r->>'votes')::int <> 2 then raise exception 'FAIL dup wish %', r; end if;
  r := public.vote_wish((r->>'id')::bigint);
  if (r->>'votes')::int <> 1 or (r->>'mine')::boolean then raise exception 'FAIL toggle %', r; end if;
  if (select count(*) from public.top_wishes(30, null) w where w.body like 'Testönskan%') < 5 then raise exception 'FAIL top'; end if;
  log := log || 'wishes ok; ';
  raise exception 'ALLPASS: %', log;
end $t$;
