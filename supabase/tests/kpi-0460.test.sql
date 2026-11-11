-- LOCAL ONLY (never Supabase): checks owner_kpi (0460) on a known small scenario. Run after 0460 on a local copy
-- (schema snapshot + live migrations). Prints PASS / FAIL lines. Leaves the rows in (throwaway database).
\set ON_ERROR_STOP 1
insert into public.owner_keys (key_hash) values (encode(extensions.digest('kpi-test-key', 'sha256'), 'hex')) on conflict do nothing;
create temp table k as select public.pnlog_day(now()) as t;
-- users: 3 anon + 2 e-mail on night t-3 at 20:00, 1 test user, 1 old user (outside the window)
insert into auth.users (id, email, is_anonymous, raw_user_meta_data, created_at)
select ('00000000-0000-0000-0000-00000000000' || i)::uuid, case when i in (4, 5) then 'u' || i || '@x.se' end, i not in (4, 5),
       case when i = 6 then '{"test":"true"}'::jsonb else '{}'::jsonb end,
       case when i = 7 then now() - interval '60 days' else ((select t from k) - 3 + time '20:00') at time zone 'Europe/Stockholm' end
  from generate_series(1, 7) i;
-- drink_log night t-3: u1 3 beers, u2 2 beers, u3 1 beer, u4 1 check-in, u6 (test) 5 beers, u1 one undone beer
insert into public.drink_log (user_id, at, night, kind, undone)
select ('00000000-0000-0000-0000-00000000000' || u)::uuid, ts, public.olnu_night_of(ts), kind, coalesce(und, false)
  from (values (1, 'beer', false), (1, 'beer', false), (1, 'beer', false), (1, 'beer', true), (2, 'beer', false), (2, 'beer', false),
               (3, 'beer', false), (4, 'checkin', false), (6, 'beer', false), (6, 'beer', false), (6, 'beer', false)) v(u, kind, und),
       lateral (select ((select t from k) - 3 + time '22:30') at time zone 'Europe/Stockholm' as ts) z;
-- night t-2: u3 one beer after midnight (still night t-2)
insert into public.drink_log (user_id, at, night, kind)
select '00000000-0000-0000-0000-000000000003'::uuid, ts, public.olnu_night_of(ts), 'beer'
  from (select ((select t from k) - 1 + time '01:30') at time zone 'Europe/Stockholm' as ts) z;
-- pnlog night t-2: u1 (err.js + crash.reload + tap), u2 (tap), u5 (err.rej), u6 test (err.js)
insert into public.pn_events (user_id, day, ev, n)
values ('00000000-0000-0000-0000-000000000001', (select t from k) - 2, '[{"t":1,"n":"err.js"},{"t":2,"n":"tap"},{"t":3,"n":"crash.reload"}]', 3),
       ('00000000-0000-0000-0000-000000000002', (select t from k) - 2, '[{"t":1,"n":"tap"}]', 1),
       ('00000000-0000-0000-0000-000000000005', (select t from k) - 2, '[{"t":1,"n":"err.rej"},{"t":2,"n":"err.rpc"}]', 2),
       ('00000000-0000-0000-0000-000000000006', (select t from k) - 2, '[{"t":1,"n":"err.js"}]', 1);
-- D7: 3 users signed up on night t-10 (u10..u12), u10 + u11 open the app on night t-3 (= d0 + 7)
insert into auth.users (id, is_anonymous, created_at)
select ('00000000-0000-0000-0000-0000000000' || i)::uuid, true, ((select t from k) - 10 + time '21:00') at time zone 'Europe/Stockholm'
  from generate_series(10, 12) i;
insert into public.pn_events (user_id, day, ev, n)
select ('00000000-0000-0000-0000-0000000000' || i)::uuid, (select t from k) - 3, '[{"t":1,"n":"app.open"}]', 1 from generate_series(10, 11) i;
-- test users by other rules: u13 beer pin in the test zone, u14 in olnu_test_users, u15 check-in in the zone but a beer pin
-- outside it (= not a test user), u16 push position in the zone only
insert into auth.users (id, is_anonymous, created_at)
select ('00000000-0000-0000-0000-0000000000' || i)::uuid, true, now() - interval '1 hour' from generate_series(13, 16) i;
set session_replication_role = replica;
insert into public.beers (user_id, lat, lng, expires_at) values ('00000000-0000-0000-0000-000000000013', 68.3, 18.8, now() + interval '1 hour'),
  ('00000000-0000-0000-0000-000000000015', 60.15, 15.19, now() + interval '1 hour');
insert into public.checkins (user_id, lat, lng, bar_id, bar_name, expires_at)
values ('00000000-0000-0000-0000-000000000015', 68.3, 18.8, 'b', 'B', now() + interval '1 hour');
set session_replication_role = origin;
insert into public.olnu_test_users (user_id) values ('00000000-0000-0000-0000-000000000014');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, lat, lng)
values ('00000000-0000-0000-0000-000000000016', 'https://e/16', 'p', 'a', 68.3, 18.8);
-- push: u1, u2
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('00000000-0000-0000-0000-000000000001', 'https://e/1', 'p', 'a'), ('00000000-0000-0000-0000-000000000002', 'https://e/2', 'p', 'a');
-- groups: 2 on t-3 (u1, u2), 3 on t-1 (u3, u4, u5), 1 by the test user on t-1
insert into public.groups (name, code, created_by, created_at)
select 'G' || i, 'KPQXZ' || (i + 1), ('00000000-0000-0000-0000-00000000000' || c)::uuid, ((select t from k) - dd + time '21:00') at time zone 'Europe/Stockholm'
  from (values (1, 1, 3), (2, 2, 3), (3, 3, 1), (4, 4, 1), (5, 5, 1), (6, 6, 1)) v(i, c, dd);
-- invites: u1 invites u2..u5 on t-3 (+ the creator row), 3 say yes
insert into public.invites (id, creator, title, starts_at, ends_at, created_at)
values (990001, '00000000-0000-0000-0000-000000000001', 'Pitchers', now(), now() + interval '3 hours', ((select t from k) - 3 + time '19:00') at time zone 'Europe/Stockholm');
insert into public.invite_people (invite_id, user_id, invited_by, answer, created_at)
select 990001, ('00000000-0000-0000-0000-00000000000' || u)::uuid, '00000000-0000-0000-0000-000000000001'::uuid, a,
       ((select t from k) - 3 + time '19:00') at time zone 'Europe/Stockholm'
  from (values (1, 'yes'), (2, 'yes'), (3, 'yes'), (4, 'yes'), (5, 'no')) v(u, a);

create temp table res as select public.owner_kpi('kpi-test-key') as j;
create temp table r3 as select x as r from res, jsonb_array_elements(j->'rows') x where (x->>'day')::date = (select t from k) - 3;
create temp table r2 as select x as r from res, jsonb_array_elements(j->'rows') x where (x->>'day')::date = (select t from k) - 2;
create temp table r10 as select x as r from res, jsonb_array_elements(j->'rows') x where (x->>'day')::date = (select t from k) - 10;
create temp table r1 as select x as r from res, jsonb_array_elements(j->'rows') x where (x->>'day')::date = (select t from k) - 1;
select case when c then 'PASS ' else 'FAIL ' end || what || case when c then '' else '  got: ' || coalesce(got, 'null') end
from (
  select 'ok + 14 rows, newest first' what, (j->>'ok') = 'true' and jsonb_array_length(j->'rows') = 14 and (j->'rows'->0->>'day')::date = (select t from k) c, left(j::text, 200) got from res
  union all select 't-3 sign-ups: 3 anon, email "<3" (test user and old user left out)', r->'su_anon' = '3' and r->'su_email' = '"<3"', r::text from r3
  union all select 't-3 groups "<3"', r->'groups' = '"<3"', r->>'groups' from r3
  union all select 'today: the invite chat group (no creator) is not a group made', r->'groups' = '0', r->>'groups' from (select j->'rows'->0 as r from res) z
  union all select 't-1 groups 3 (test creator left out)', r->'groups' = '3', r->>'groups' from r1
  union all select 't-3 nights out 4 (beer or check-in; test user left out)', r->'out' = '4', r->>'out' from r3
  union all select 't-3 cohort 5, D2 4 = 80 % (u1, u2, u5 pnlog + u3 beer), D7 not yet (null)', r->'coh' = '5' and r->'d2' = '4' and r->'d2_pct' = '80' and r->'d7' = 'null', r::text from r3
  union all select 't-10 cohort 3, D7 "<3", D7 % "<3" (2 of 3 masked)', r->'coh' = '3' and r->'d7' = '"<3"' and r->'d7_pct' = '"<3"', r::text from r10
  union all select 'week D7: the 7 cohorts t-13..t-7 (3 people, "<3" back)', j->'week'->'coh7' = '3' and j->'week'->'d7' = '"<3"', (j->'week')::text from res
  union all select 't-3 beers median 2 (3, 2, 1; undone row not counted)', r->'beers_med' = '2', r->>'beers_med' from r3
  union all select 't-3 push share "<3" (2 of 4)', r->'push' = '"<3"', r->>'push' from r3
  union all select 't-3 invites sent 4, yes 3 (creator row left out)', r->'inv_sent' = '4' and r->'inv_yes' = '3', r::text from r3
  union all select 't-2 active 4 (u1, u2, u5 pnlog + u3 beer after midnight), out "<3"', r->'act' = '4' and r->'out' = '"<3"', r::text from r2
  union all select 't-2 crashes 3 (err.js, crash.reload, err.rej; err.rpc and test user not counted), 1.00 per user', r->'crashes' = '3' and (r->>'cpu')::numeric = 1, r::text from r2
  union all select 'week: sign-ups anon 4 (u1-u3 + u15 today), d2 cohort 5 / d2 4, people out 4, groups 5 (no invite chat), 4 nights out + 1', j->'week'->'su_anon' = '4' and j->'week'->'coh2' = '5' and j->'week'->'d2' = '4' and j->'week'->'people_out' = '4' and j->'week'->'groups' = '5' and j->'week'->'out' = '5', (j->'week')::text from res
  union all select 'olnu_kpi_tests() = the users olnu_is_test_uid() says are test users (u6, u13, u14, u16)',
        (select array_agg(id order by id) from public.olnu_kpi_tests()) = (select array_agg(id order by id) from auth.users where public.olnu_is_test_uid(id))
        and (select count(*) from public.olnu_kpi_tests()) = 4, (select string_agg(right(id::text, 2), ',') from public.olnu_kpi_tests())
  union all select 'no user id or position in the answer', j::text !~ '00000000-0000|lat|lng', null from res
  union all select 'wrong key = forbidden, no rows', (select public.owner_kpi('wrong-key')) ->> 'message' = 'forbidden' and not ((select public.owner_kpi('wrong-key')) ? 'rows'), null
  union all select 'anon may execute, PUBLIC may not run the helpers', has_function_privilege('anon', 'public.owner_kpi(text,integer)', 'execute')
        and not has_function_privilege('anon', 'public.olnu_kpi_m(numeric)', 'execute'), null
) z;
