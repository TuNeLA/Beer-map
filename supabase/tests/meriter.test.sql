-- Local tests for 0036 MERITER (ledger, triggers, caps, RPCs).
-- Run on a scratch database that has setup.sql + 0090-0092 + 0033-0035 + 0036 (+ _b, _c):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/meriter.test.sql
-- Prints "PASS ..." per check; the first failure stops the run. Made-up user ids only.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function pg_temp.as_u(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', false),
         set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); $$;
create or replace function pg_temp.ok(c boolean, msg text) returns text language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; return 'PASS ' || msg; end; $$;
create or replace function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return 'no error'; exception when others then return sqlerrm; end; $$;
create or replace function pg_temp.m(u text) returns int language sql security definer as $$
  select coalesce((select total from public.meriter_totals where user_id = u::uuid), 0) $$;
create or replace function pg_temp.mk(u text, k text) returns int language sql security definer as $$
  select coalesce(sum(pts), 0)::int from public.meriter_log where user_id = u::uuid and kind = k $$;
create or replace function pg_temp.tt(m int) returns text language sql security definer as $$
  select title from public.olnu_rank_of(m) $$;
create or replace function pg_temp.life(u text) returns int language sql security definer as $$
  select public.olnu_lifetime(u::uuid) $$;
-- next drink allowed: move the cooldown back (as the owner of the tables)
create or replace function pg_temp.cool(u text) returns void language sql as $$
  update public.beers set beer_at = beer_at - interval '11 minutes', updated_at = updated_at - interval '11 minutes',
                          other_at = other_at - interval '11 minutes' where user_id = u::uuid $$;
\set u1 '''f2222222-0000-4000-8000-000000000001'''
\set u2 '''f2222222-0000-4000-8000-000000000002'''
\set u3 '''f2222222-0000-4000-8000-000000000003'''
\set u4 '''f2222222-0000-4000-8000-000000000004'''

-- ---------- Ladder ----------
select pg_temp.ok((select count(*) from public.olnu_titles()) = 42, '42 ranks');
select pg_temp.ok((select title from public.olnu_rank_of(0)) = 'Rekryt' and (select idx from public.olnu_rank_of(0)) = 1, 'rank of 0');
select pg_temp.ok((select title from public.olnu_rank_of(7000)) = 'Ölguden' and (select next_at from public.olnu_rank_of(9999)) is null, 'top rank');
select pg_temp.ok((select next_at from public.olnu_rank_of(39)) = 40, 'next_at');

set role authenticated;
select pg_temp.as_u(:u1);
select (public.create_group('Mertest', 'Ett')->>'code') as c1 \gset
select g.id as g1 from public.my_groups() g where g.code = :'c1' \gset
select pg_temp.as_u(:u2); select public.join_group(:'c1', 'Två') is not null;
select pg_temp.as_u(:u3); select public.join_group(:'c1', 'Tre') is not null;
select pg_temp.as_u(:u4); select (public.create_group('Ensam', 'Fyra')->>'code') is not null;

-- ---------- Drinks: +1 each; alone = no squad ----------
select pg_temp.as_u(:u1);
select (public.post_beer_v2(68.35, 18.80, true)->>'accepted')::boolean;
select pg_temp.ok(pg_temp.m(:u1) = 1 and pg_temp.mk(:u1, 'squad') = 0, 'first beer +1, no squad alone');
reset role; select pg_temp.cool(:u1); set role authenticated;
select (public.post_beer_v2(68.35, 18.80, true)->>'accepted')::boolean;
select pg_temp.ok(pg_temp.mk(:u1, 'drink') = 2, 'second beer +1');
-- undo then drink again: never pays twice
select (public.undo_beer()->>'ok')::boolean;
reset role; select pg_temp.cool(:u1); set role authenticated;
select (public.post_beer_v2(68.35, 18.80, true)->>'accepted')::boolean;
select pg_temp.ok(pg_temp.mk(:u1, 'drink') = 2, 'undo + re-drink pays once');

-- ---------- Squad: mate within 150 m → +10 both, once per night ----------
select pg_temp.as_u(:u2);
select (public.post_beer_v2(68.3505, 18.8005, true)->>'accepted')::boolean;
select pg_temp.ok(pg_temp.mk(:u2, 'squad') = 10 and pg_temp.mk(:u1, 'squad') = 10, 'squad +10 for both');
reset role; select pg_temp.cool(:u2); set role authenticated;
select (public.post_beer_v2(68.3505, 18.8005, true)->>'accepted')::boolean;
select pg_temp.ok(pg_temp.mk(:u2, 'squad') = 10, 'squad once per night');
-- u4 (other group) next to them: no squad
select pg_temp.as_u(:u4);
select (public.post_beer_v2(68.3502, 18.8002, true)->>'accepted')::boolean;
select pg_temp.ok(pg_temp.mk(:u4, 'squad') = 0, 'stranger at the same spot: no squad');
-- u3 far away (2 km): no squad
select pg_temp.as_u(:u3);
select (public.post_beer_v2(68.37, 18.80, true)->>'accepted')::boolean;
select pg_temp.ok(pg_temp.mk(:u3, 'squad') = 0, 'mate 2 km away: no squad');

-- ---------- Check-in: +3 per bar, 1 per bar, 6 bars max ----------
select pg_temp.as_u(:u3);
select (public.check_in('mt_bar1', 'Testbaren', 68.371, 18.80)->>'ok')::boolean;
select pg_temp.ok(pg_temp.mk(:u3, 'checkin') = 3, 'check-in +3');
reset role; update public.checkins set created_at = created_at - interval '3 minutes' where user_id = :u3::uuid; set role authenticated;
select (public.check_in('mt_bar1', 'Testbaren', 68.371, 18.80)->>'ok')::boolean;
select pg_temp.ok(pg_temp.mk(:u3, 'checkin') = 3, 'same bar again: nothing');
do $$ declare i int; begin
  for i in 2..9 loop
    execute 'reset role'; update public.checkins set created_at = created_at - interval '3 minutes' where user_id = 'f2222222-0000-4000-8000-000000000003';
    execute 'set role authenticated';
    perform public.check_in('mt_bar' || i, 'Bar ' || i, 68.371, 18.80);
  end loop; end $$;
select pg_temp.ok(pg_temp.mk(:u3, 'checkin') = 18, 'check-ins capped at 18 (6 bars)');
-- check-in next to the squad → squad for u3 (+ u1/u2 already have it)
reset role; update public.checkins set created_at = created_at - interval '3 minutes' where user_id = :u3::uuid; set role authenticated;
select (public.check_in('mt_near', 'Nära', 68.3504, 18.8004)->>'ok')::boolean;
select pg_temp.ok(pg_temp.mk(:u3, 'squad') = 10 and pg_temp.mk(:u3, 'checkin') = 18, 'check-in near mates: squad, check-in cap holds');

-- ---------- Skål: +1 giver, +1 owner, caps 10 ----------
reset role; select id as b1 from public.beers where user_id = :u1::uuid \gset
set role authenticated;
select pg_temp.as_u(:u2);
select (public.skal(:b1)->>'skal_count')::int;
select pg_temp.ok(pg_temp.mk(:u2, 'skal_give') = 1 and pg_temp.mk(:u1, 'skal_get') = 1, 'skål +1 / +1');
select (public.skal(:b1)->>'already')::boolean;
select pg_temp.ok(pg_temp.mk(:u2, 'skal_give') = 1, 'second skål on the same pin: nothing');

-- ---------- Call-out: yes +5, creator +5 at 2 answers, arrive +5 ----------
select pg_temp.as_u(:u1);
select (public.create_rally(:'g1', 'Kom till baren', 'Nära', 68.3504, 18.8004)->>'id')::bigint as r1 \gset
select pg_temp.as_u(:u2);
select (public.answer_rally(:r1, 'yes')->>'yes')::int;
select pg_temp.ok(pg_temp.mk(:u2, 'rally_yes') = 5 and pg_temp.mk(:u1, 'callout') = 0, 'yes +5; 1 answer = no callout yet');
select (public.answer_rally(:r1, 'no')->>'no')::int;
select (public.answer_rally(:r1, 'yes')->>'yes')::int;
select pg_temp.ok(pg_temp.mk(:u2, 'rally_yes') = 5, 'yes → no → yes pays once');
select pg_temp.as_u(:u3);
select (public.answer_rally(:r1, 'maybe')->>'maybe')::int;
select pg_temp.ok(pg_temp.mk(:u1, 'callout') = 5 and pg_temp.mk(:u3, 'rally_yes') = 0, 'creator +5 at 2 answers; maybe pays nothing');
select pg_temp.as_u(:u1);
select pg_temp.ok(pg_temp.mk(:u1, 'rally_yes') = 0, 'own call-out: no rally_yes');
select pg_temp.as_u(:u2);
select (public.check_in('mt_near', 'Nära', 68.3504, 18.8004)->>'ok')::boolean;
select pg_temp.ok(pg_temp.mk(:u2, 'arrive') = 5, 'arrived at the call-out: +5');

-- ---------- Home: +5 once ----------
select (public.mark_home()->>'ok')::boolean;
select (public.mark_home()->>'ok')::boolean;
select pg_temp.ok(pg_temp.mk(:u2, 'home') = 5, 'home +5 once');

-- ---------- Medevac check +5 ----------
reset role; update public.beers set beer_count = 10 where user_id = :u1::uuid; set role authenticated;
select (public.claim_medevac(:b1)->>'ok')::boolean;
select pg_temp.ok(pg_temp.mk(:u2, 'buddy') = 5, 'Jag kollar +5');
select pg_temp.ok(pg_temp.mk(:u1, 'drink') = 10, 'beer_count jump: +1 per drink');

-- ---------- Push "Kom hit!" row → callout (cap 10) ----------
reset role;
insert into public.push_sent (user_id, kind, night, sent_at) values (:u1::uuid, 'comehere', now(), now());
select pg_temp.ok(pg_temp.mk(:u1, 'callout') = 10, 'Kom hit! +5 (callout 10)');
-- direct cap check through the helper
select public.olnu_mer_add(:u1::uuid, public.olnu_night_of(now()), 'callout', 'r:999', 5, 10);
select pg_temp.ok(pg_temp.mk(:u1, 'callout') = 10, 'callout cap 10');

-- ---------- Photos, lägesrapport, games, duels (direct fact rows, as the owner) ----------
with m as (insert into public.group_msgs (group_id, user_id, body, created_at, expires_at)
           values (:'g1', :u3::uuid, '📷', now(), public.olnu_next_expiry()) returning id)
insert into public.chat_photos (group_id, user_id, msg_id, mime, bytes, size, w, h, created_at, expires_at)
select :'g1', :u3::uuid, m.id, 'image/jpeg', '\xffd8ff'::bytea, 3, 1, 1, now(), public.olnu_next_expiry() from m;
select pg_temp.ok(pg_temp.mk(:u3, 'photo') = 2, 'chat photo +2');
with m as (insert into public.group_msgs (group_id, user_id, body, created_at, expires_at)
           values (:'g1', :u3::uuid, '📷 🎖️ Lägesrapport', now(), public.olnu_next_expiry()) returning id)
insert into public.chat_photos (group_id, user_id, msg_id, mime, bytes, size, w, h, created_at, expires_at)
select :'g1', :u3::uuid, m.id, 'image/jpeg', '\xffd8ff'::bytea, 3, 1, 1, now(), public.olnu_next_expiry() from m;
select pg_temp.ok(pg_temp.mk(:u3, 'photo') = 2, 'lägesrapport photo: no photo meriter');
insert into public.status_reqs (group_id, user_id, night, created_at, ends_at)
values (:'g1', :u1::uuid, public.olnu_night_of(now()), now(), now() + interval '10 minutes');
insert into public.status_answers (req_id, user_id, created_at)
select max(id), :u3::uuid, now() from public.status_reqs where group_id = :'g1';
select pg_temp.ok(pg_temp.mk(:u3, 'status') = 5, 'lägesrapport in time +5');
insert into public.status_reqs (group_id, user_id, night, created_at, ends_at)
values (:'g1', :u1::uuid, public.olnu_night_of(now()), now() - interval '30 minutes', now() - interval '20 minutes');
insert into public.status_answers (req_id, user_id, created_at)
select max(id), :u3::uuid, now() from public.status_reqs where group_id = :'g1';
select pg_temp.ok(pg_temp.mk(:u3, 'status') = 5, 'late lägesrapport: nothing');
insert into public.game_missions (user_id, night, slot, mission, kind, goal, progress)
select :u3::uuid, public.olnu_night_of(now()), s, 'm001', 'chat', 1, 0 from generate_series(1, 3) s;
update public.game_missions set done_at = now(), progress = 1 where user_id = :u3::uuid;
insert into public.game_oracles (group_id, night, user_id, guess, real, err, guessers)
values (:'g1', public.olnu_night_of(now()), :u3::uuid, 1, 1, 0, 2);
select pg_temp.ok(pg_temp.mk(:u3, 'game') = 9, 'games +3 each, cap 9');
-- duel: group g1 (u1 drank) beats u4's group
select g.id as g4 from public.groups g join public.group_members m on m.group_id = g.id where m.user_id = :u4::uuid \gset
insert into public.duels (group_a, group_b, created_by, via, status, created_at, answer_by, accepted_at, ends_at)
values (:'g1', :'g4', :u1::uuid, 'code', 'active', now() - interval '2 hours', now(), now() - interval '2 hours', now() - interval '1 minute');
insert into public.duel_log (user_id, kind, n, at) values (:u1::uuid, 'drink', 1, now() - interval '1 hour'),
  (:u2::uuid, 'skal', 1, now() - interval '1 hour'), (:u4::uuid, 'drink', 1, now() - interval '1 hour');
update public.duels set winner = 'a', finished_at = now() where group_a = :'g1';
select pg_temp.ok(pg_temp.mk(:u1, 'duel_win') = 15 and pg_temp.mk(:u1, 'duel') = 5, 'duel winner who drank: +15 +5');
select pg_temp.ok(pg_temp.mk(:u2, 'duel_win') = 0 and pg_temp.mk(:u2, 'duel') = 5, 'winner side without drinks: +5 only');
select pg_temp.ok(pg_temp.mk(:u4, 'duel_win') = 0 and pg_temp.mk(:u4, 'duel') = 5, 'loser who took part: +5');
select pg_temp.ok(pg_temp.mk(:u3, 'duel') = 0, 'no activity: nothing');
-- totals = ledger
select pg_temp.ok((select bool_and(t.total = s.n) from public.meriter_totals t
                    join (select user_id, sum(pts)::int n from public.meriter_log group by 1) s on s.user_id = t.user_id), 'totals = ledger');
set role authenticated;

-- ---------- RPCs ----------
select pg_temp.as_u(:u1);
select pg_temp.ok((public.my_stats()->>'meriter')::int = pg_temp.m(:u1), 'my_stats.meriter');
select pg_temp.ok((public.my_stats()->>'title') = pg_temp.tt(pg_temp.m(:u1)), 'my_stats.title by meriter');
select pg_temp.ok((public.my_stats()->>'total')::int = pg_temp.life(:u1), 'my_stats.total stays lifetime drinks');
select pg_temp.ok(jsonb_array_length(public.my_meriter(0)->'events') = 0 and (public.my_meriter(0)->>'last_id')::bigint > 0, 'my_meriter(0): no events, last_id');
select pg_temp.ok(jsonb_array_length(public.my_meriter(1)->'events') > 0, 'my_meriter(1): events');
select pg_temp.ok((public.my_meriter(0)->>'tonight')::int = pg_temp.m(:u1), 'tonight meriter');
select pg_temp.ok((select count(*) from public.group_status_v3(:'g1')) = 3, 'group_status_v3 rows');
select pg_temp.ok((select meriter from public.group_status_v3(:'g1') where is_me) = pg_temp.m(:u1), 'group_status_v3 meriter');
select pg_temp.ok((select count(*) from public.meriter_board('group', :'g1', null, null, 'week')) = 3, 'group board');
select pg_temp.ok((select rank from public.meriter_board('group', :'g1', null, null, 'all') order by meriter desc limit 1) = 1, 'group board rank');
select pg_temp.ok((select count(*) from public.meriter_board('town', null, 68.35, 18.80, 'tonight')) >= 1, 'town board');
select pg_temp.ok((select bool_and(name is null) from public.meriter_board('town', null, 68.35, 18.80, 'all') where not is_me), 'town board hides names (no opt-in)');
select pg_temp.as_u(:u4);
select pg_temp.ok(pg_temp.err('select * from public.meriter_board(''group'', ''' || :'g1' || ''')') like '%not_member%', 'group board: members only');
select pg_temp.ok(pg_temp.err('select * from public.group_status_v3(''' || :'g1' || ''')') like '%not_member%', 'group_status_v3: members only');
select pg_temp.as_u(:u1);
select pg_temp.ok((select (p->>'meriter')::int from json_array_elements(public.poll_v2(68, 18, 69, 19)->'pins') p where (p->>'is_mine')::boolean) = pg_temp.m(:u1), 'poll_v2 own pin meriter');
select pg_temp.ok((public.poll_v2(68, 18, 69, 19)->'me'->>'meriter')::int = pg_temp.m(:u1), 'poll_v2 me.meriter');
select pg_temp.ok((select count(*) from json_array_elements(public.poll_v2(68, 18, 69, 19)->'pins') p where p->>'meriter' is not null) = 3, 'poll_v2: meriter only for me + mates');
select pg_temp.ok((public.my_wrapped('month', 0)->>'title') = pg_temp.tt(pg_temp.m(:u1)), 'my_wrapped title by meriter');
-- clients cannot touch the ledger
select pg_temp.ok(pg_temp.err('select count(*) from public.meriter_log') like '%permission%', 'ledger table closed');
select pg_temp.ok(pg_temp.err('select public.olnu_mer_add(''' || :u1 || '''::uuid, now(), ''drink'', ''x'', 50)') like '%permission%', 'award helper closed');
reset role;
select 'DONE meriter';
