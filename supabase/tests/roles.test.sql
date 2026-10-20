-- Local tests for 0033 HEMSTAD, 0034 ROLLER + remove_member, 0035 titles.
-- Run on a scratch database that has setup.sql + 0090-0092 + 0033-0035:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/roles.test.sql
-- Prints "PASS ..." per check; the first failure stops the run. Uses made-up user ids only.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
-- Same auth.uid() as Supabase (claim.sub, else request.jwt.claims ->> sub).
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
-- Like PostgREST: only request.jwt.claims is set.
create or replace function pg_temp.as_u(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', false),
         set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); $$;
create or replace function pg_temp.ok(c boolean, msg text) returns text language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; return 'PASS ' || msg; end; $$;
create or replace function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return 'no error'; exception when others then return sqlerrm; end; $$;
create or replace function pg_temp.k(g uuid, nm text) returns text language sql as $$
  select m->>'k' from jsonb_array_elements(public.chief_state(g)->'members') m where m->>'name' = nm $$;
\set u1 '''e1111111-0000-4000-8000-000000000001'''
\set u2 '''e1111111-0000-4000-8000-000000000002'''
\set u3 '''e1111111-0000-4000-8000-000000000003'''
\set u4 '''e1111111-0000-4000-8000-000000000004'''
\set u5 '''e1111111-0000-4000-8000-000000000005'''
\set u6 '''e1111111-0000-4000-8000-000000000006'''
set role authenticated;

-- ---------- Setup: Owner (u1) + Plain (u2) + Chief (u3) + Vice (u4) + Vice2 (u5); u6 outsider ----------
select pg_temp.as_u(:u1);
select (public.create_group('Rolltest', 'Ägaren')->>'code') as c1 \gset
select g.id as g1 from public.my_groups() g where g.code = :'c1' \gset
select pg_temp.as_u(:u2); select public.join_group(:'c1', 'Menig') is not null;
select pg_temp.as_u(:u3); select public.join_group(:'c1', 'Chefen') is not null;
select pg_temp.as_u(:u4); select public.join_group(:'c1', 'Vicen') is not null;
select pg_temp.as_u(:u5); select public.join_group(:'c1', 'Vice2') is not null;
select pg_temp.as_u(:u6); select (public.create_group('Annan', 'Utböling')->>'code') as c2 \gset

select pg_temp.as_u(:u1);
select pg_temp.k(:'g1', 'Ägaren') as k1 \gset
select pg_temp.k(:'g1', 'Menig') as k2 \gset
select pg_temp.k(:'g1', 'Chefen') as k3 \gset
select pg_temp.k(:'g1', 'Vicen') as k4 \gset
select pg_temp.k(:'g1', 'Vice2') as k5 \gset
select pg_temp.ok((public.chief_state(:'g1')->>'is_owner')::boolean and (public.chief_state(:'g1')->>'is_chief')::boolean, 'owner is chief by default');
select pg_temp.ok((public.chief_state(:'g1')->>'owner_powers')::boolean, 'owner has owner powers');

-- ---------- Plain member: nothing allowed ----------
select pg_temp.as_u(:u2);
select pg_temp.ok(pg_temp.err('select public.set_vice(''' || :'g1' || ''', ''' || :'k4' || ''')') like '%not_allowed%', 'plain cannot make vice');
select pg_temp.ok(pg_temp.err('select public.set_chief(''' || :'g1' || ''', ''' || :'k2' || ''')') like '%not_allowed%', 'plain cannot make self chief');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k4' || ''')') like '%not_allowed%', 'plain cannot remove');
select pg_temp.ok(pg_temp.err('select public.request_status(''' || :'g1' || ''')') like '%not_chief%', 'plain cannot request status');
select pg_temp.ok(not (public.chief_state(:'g1')->>'can_remove')::boolean, 'plain: can_remove false');

-- ---------- Owner appoints: u3 chief, u4 + u5 vices ----------
select pg_temp.as_u(:u1);
select pg_temp.ok((public.set_chief(:'g1', :'k3')->>'chief_name') = 'Chefen', 'owner makes u3 chief');
select pg_temp.ok(jsonb_array_length(public.set_vice(:'g1', :'k4')->'vices') = 1, 'owner makes u4 vice');
select pg_temp.ok(jsonb_array_length(public.set_vice(:'g1', :'k5', true)->'vices') = 2, 'owner makes u5 vice (any number)');
select pg_temp.ok(pg_temp.err('select public.set_vice(''' || :'g1' || ''', ''' || :'k1' || ''')') like '%invalid_member%', 'owner cannot be vice');
select pg_temp.ok(pg_temp.err('select public.set_vice(''' || :'g1' || ''', ''' || :'k3' || ''')') like '%invalid_member%', 'chief cannot be vice');
select pg_temp.ok(pg_temp.err('select public.set_vice(''' || :'g1' || ''', ''nokey'')') like '%invalid_member%', 'unknown key');

-- ---------- Chief (not owner): cannot appoint ----------
select pg_temp.as_u(:u3);
select pg_temp.ok((public.chief_state(:'g1')->>'is_chief')::boolean and not (public.chief_state(:'g1')->>'can_hand')::boolean, 'chief: no can_hand');
select pg_temp.ok(pg_temp.err('select public.set_vice(''' || :'g1' || ''', ''' || :'k2' || ''')') like '%not_allowed%', 'chief cannot make vice');
select pg_temp.ok(pg_temp.err('select public.set_vice(''' || :'g1' || ''', ''' || :'k4' || ''', false)') like '%not_allowed%', 'chief cannot clear vice');
select pg_temp.ok(pg_temp.err('select public.set_chief(''' || :'g1' || ''', ''' || :'k2' || ''')') like '%not_allowed%', 'chief cannot hand on chief');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k4' || ''')') like '%not_allowed%', 'chief cannot remove vice');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k1' || ''')') like '%cannot_remove_creator%', 'chief cannot remove owner');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k3' || ''')') like '%cannot_remove_self%', 'chief cannot remove self');

-- ---------- Vice: limited ----------
select pg_temp.as_u(:u4);
select pg_temp.ok((public.chief_state(:'g1')->>'is_vice')::boolean and (public.chief_state(:'g1')->>'can_req')::boolean, 'vice: is_vice + can_req');
select pg_temp.ok(pg_temp.err('select public.set_vice(''' || :'g1' || ''', ''' || :'k2' || ''')') like '%not_allowed%', 'vice cannot add vice');
select pg_temp.ok(pg_temp.err('select public.set_vice(''' || :'g1' || ''', ''' || :'k5' || ''', false)') like '%not_allowed%', 'vice cannot clear other vice');
select pg_temp.ok(pg_temp.err('select public.set_chief(''' || :'g1' || ''', ''' || :'k4' || ''')') like '%not_allowed%', 'vice cannot make self chief');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k3' || ''')') like '%not_allowed%', 'vice cannot remove chief');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k5' || ''')') like '%not_allowed%', 'vice cannot remove other vice');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k1' || ''')') like '%cannot_remove_creator%', 'vice cannot remove owner');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k4' || ''')') like '%cannot_remove_self%', 'vice cannot remove self');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ' || quote_literal(:u1) || ')') like '%cannot_remove_creator%', 'uuid form: still not the owner');
select pg_temp.ok((select bool_and(case when s.k = :'k2' then s.can_remove else not s.can_remove end) from public.group_status_v2(:'g1') s), 'vice: can_remove only on the plain member');

-- Lägesrapport by the vice; limit shared with the chief
select pg_temp.ok((public.request_status(:'g1')->>'by') = 'Vicen', 'vice requests status');
select pg_temp.as_u(:u3);
select pg_temp.ok(pg_temp.err('select public.request_status(''' || :'g1' || ''')') like '%status_slow%', 'chief hits the shared 20 min limit');

-- ---------- Vice removes the plain member ----------
select pg_temp.as_u(:u4);
select pg_temp.ok((public.remove_member(:'g1', :'k2')->>'name') = 'Menig', 'vice removes plain member');
select pg_temp.ok((public.chief_state(:'g1')->>'is_vice')::boolean, 'claims switched back to the vice');
select pg_temp.as_u(:u2);
select pg_temp.ok(pg_temp.err('select public.chief_state(''' || :'g1' || ''')') like '%not_member%', 'removed: not a member');
select pg_temp.ok(pg_temp.err('select * from public.group_msgs(''' || :'g1' || ''')') like '%not_member%', 'removed: no chat');
select pg_temp.ok(not exists (select 1 from public.my_groups() g where g.id = :'g1'), 'removed: group gone from my_groups');
select pg_temp.ok(jsonb_array_length(public.my_removals()) = 1, 'removed: my_removals has 1');
select pg_temp.ok(jsonb_array_length(public.my_removals()) = 0, 'removed: shown once');
select pg_temp.ok(public.join_group(:'c1', 'Menig') is not null, 'removed: can rejoin with code');
select pg_temp.ok(not (public.chief_state(:'g1')->>'is_vice')::boolean, 'rejoined: plain');
select pg_temp.as_u(:u6);
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k2' || ''')') like '%not_member%', 'outsider cannot remove');
select pg_temp.as_u(:u1);
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''nokey'')') like '%not_member%', 'unknown target = not_member');

-- ---------- Owner removes a vice: role gone after rejoin ----------
select pg_temp.ok((public.remove_member(:'g1', :'k5')->>'ok')::boolean, 'owner removes vice u5');
select pg_temp.as_u(:u5);
select public.join_group(:'c1', 'Vice2') is not null;
select pg_temp.ok(not (public.chief_state(:'g1')->>'is_vice')::boolean, 'removed vice rejoins as plain');
-- voluntary leave + rejoin also ends the vice role (member_since check)
select pg_temp.as_u(:u1);
select public.set_vice(:'g1', :'k5') is not null;
select pg_temp.as_u(:u5);
select public.leave_group(:'g1');
select public.join_group(:'c1', 'Vice2') is not null;
select pg_temp.ok(not (public.chief_state(:'g1')->>'is_vice')::boolean, 'left vice rejoins as plain');

-- ---------- Owner removes the chief: chief goes back to the owner ----------
select pg_temp.as_u(:u1);
select pg_temp.ok((public.remove_member(:'g1', :'k3')->'state'->>'chief_k') = :'k1', 'removed chief -> owner is chief again');
select pg_temp.ok(pg_temp.err('select public.remove_member(''' || :'g1' || ''', ''' || :'k1' || ''')') like '%cannot_remove_self%', 'owner cannot remove self');
select pg_temp.as_u(:u3);
select public.join_group(:'c1', 'Chefen') is not null;
select pg_temp.ok(not (public.chief_state(:'g1')->>'is_chief')::boolean, 'removed chief rejoins as plain');

-- ---------- Owner absent: the chief gets owner powers ----------
select pg_temp.as_u(:u1);
select public.set_chief(:'g1', :'k3') is not null;
select public.leave_group(:'g1');
select pg_temp.as_u(:u3);
select pg_temp.ok((public.chief_state(:'g1')->>'owner_powers')::boolean, 'owner gone -> chief has owner powers');
select pg_temp.as_u(:u1);
select public.join_group(:'c1', 'Ägaren') is not null;
select pg_temp.ok((public.chief_state(:'g1')->>'is_owner')::boolean, 'owner back -> still owner');
select pg_temp.as_u(:u3);
select pg_temp.ok(not (public.chief_state(:'g1')->>'owner_powers')::boolean, 'owner back -> chief loses owner powers');

-- ---------- Acting vice after 12 h without the chief ----------
select pg_temp.as_u(:u1);
select public.set_vice(:'g1', :'k4') is not null;
select pg_temp.as_u(:u4); select public.mark_seen();
select pg_temp.ok((public.chief_state(:'g1')->>'acting_k') is null, 'chief active -> nobody acting');
reset role;
update public.group_members set joined_at = now() - interval '13 hours' where group_id = :'g1' and user_id = :u3;
update public.group_chiefs set updated_at = now() - interval '13 hours' where group_id = :'g1';
set role authenticated;
select pg_temp.as_u(:u2);
select pg_temp.ok((public.chief_state(:'g1')->>'acting_k') = :'k4' and (public.chief_state(:'g1')->>'chief_idle')::boolean, 'chief idle 12 h -> vice acting');
select pg_temp.ok((select s.is_acting from public.group_status_v2(:'g1') s where s.k = :'k4'), 'group_status_v2 is_acting');
select pg_temp.as_u(:u3); select public.mark_seen();
select pg_temp.ok((public.chief_state(:'g1')->>'acting_k') is null, 'chief back -> nobody acting');

-- ---------- Rate limit: 20 removals per hour ----------
select pg_temp.as_u(:u1);
select set_config('t.code', :'c1', false), set_config('t.g', :'g1', false);
do $$
declare i int; c text := current_setting('t.code');
begin
  for i in 1..21 loop
    perform set_config('request.jwt.claims', json_build_object('sub', ('f0000000-0000-4000-8000-' || lpad(i::text, 12, '0')))::text, false);
    perform public.join_group(c, 'Temp' || i);
  end loop;
end $$;
select pg_temp.as_u(:u1);
do $$
declare i int; g uuid := current_setting('t.g')::uuid; v_err text := null;
begin
  for i in 1..21 loop
    begin
      perform public.remove_member(g, ('f0000000-0000-4000-8000-' || lpad(i::text, 12, '0')));
    exception when others then if v_err is null then v_err := sqlerrm || ' at ' || i; end if;
    end;
  end loop;
  -- earlier removals by u1 in this hour: u5, u3 (2) -> temp #19 would be the 21st -> first error at 19
  if v_err is null or v_err not like 'slow_down at 19' then raise exception 'FAIL rate limit: %', v_err; end if;
  raise notice 'PASS rate limit 20/h (%)', v_err;
end $$;

-- ---------- Hemstad ----------
select pg_temp.as_u(:u4);
select pg_temp.ok((public.set_home_town('  Smedjebacken ')->>'town') = 'Smedjebacken', 'set home town (trimmed)');
select pg_temp.ok(pg_temp.err('select public.set_home_town(''Falun'')') like '%slow_down%', 'home town 3 s limit');
select pg_temp.ok(pg_temp.err('select public.set_home_town(''<script>'')') like '%invalid_town%', 'bad chars');
select pg_temp.ok(pg_temp.err('select public.set_home_town(''' || repeat('a', 31) || ''')') like '%invalid_town%', '31 chars');
select pg_temp.ok(pg_temp.err('select public.set_home_town(''123'')') like '%invalid_town%', 'no letters');
select pg_temp.ok(pg_temp.err('select public.set_home_town(''Kiruna 🍺'')') like '%invalid_town%', 'emoji');
select pg_temp.ok((public.my_home_town()->>'town') = 'Smedjebacken', 'my_home_town');
select pg_temp.as_u(:u2);
select pg_temp.ok((select s.home_town from public.group_status_v2(:'g1') s where s.k = :'k4') = 'Smedjebacken', 'home town in group_status_v2');
select pg_temp.ok((select m->>'home_town' from jsonb_array_elements(public.chief_state(:'g1')->'members') m where m->>'k' = :'k4') = 'Smedjebacken', 'home town in chief_state');
select pg_temp.ok((public.set_home_town('Sankt Göran-Ö''s (Gbg)')->>'town') = 'Sankt Göran-Ö''s (Gbg)', 'punctuation ok');
reset role;
update public.user_home set updated_at = now() - interval '1 minute';
set role authenticated;
select pg_temp.ok((public.set_home_town('')->>'town') is null, 'empty clears');
select pg_temp.ok(pg_temp.err('select * from public.local_board_v2(68.35, 18.80, 20, ''tonight'')') = 'no error', 'local_board_v2 runs');
select pg_temp.ok(pg_temp.err('select * from public.wall_of_fame_v2(68.35, 18.80, 20)') = 'no error', 'wall_of_fame_v2 runs');

-- ---------- Old RPCs still fine ----------
select pg_temp.ok((select count(*) from public.group_status(:'g1')) = (select count(*) from public.group_status_v2(:'g1')), 'old group_status same rows');
select pg_temp.ok(jsonb_array_length(public.chief_state(:'g1')->'members') >= 3, 'old chief_state');

-- ---------- Grants ----------
reset role;
select pg_temp.ok(not has_function_privilege('anon', 'public.remove_member(uuid, text)', 'execute'), 'anon cannot remove_member');
select pg_temp.ok(not has_function_privilege('anon', 'public.set_home_town(text)', 'execute'), 'anon cannot set_home_town');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.olnu_remove_block(uuid, uuid, uuid)', 'execute'), 'helper not granted');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.group_vices', 'select'), 'no table access');

-- ---------- Titles ----------
select pg_temp.ok((select count(*) from public.olnu_titles()) = 36, '36 titles');
select pg_temp.ok(not exists (select 1 from public.olnu_titles() t where t.title ~* '(från|dalarna|dala|ludvika|väsman|grängesberg|säfsnäs|smedjebacken|grangärde|humlegården)'), 'no place names');
select pg_temp.ok((select string_agg(t.at::text, ',' order by t.at) from public.olnu_titles() t)
  = '0,3,5,7,10,13,17,22,28,35,43,52,62,75,90,110,130,155,180,210,245,285,330,380,430,490,560,640,730,830,920,1000,1100,1200,1300,1500', 'same thresholds');
select 'DONE';
