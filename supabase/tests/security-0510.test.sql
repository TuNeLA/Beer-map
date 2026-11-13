-- 0510 (lane secaudit): a block really hides + group code IP limit + server age gate + ghost guard.
-- LOCAL / staging copy only. One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- usage:
--   psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0510_security_audit.sql -f supabase/tests/security-0510.test.sql
-- Old code proof: -v mig=/dev/null → the "block" / "ip" / "age" lines print |f|.
-- Prints "name|ok|detail" lines; any "|f|" = fail.
-- Fresh anonymous users: V victim, K the person V blocks, M group mate (control), U says "under 18".
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES
  ('00000000-0000-4000-8000-0000000510a1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000510a2', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000510a4', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000510a5', 'authenticated', 'authenticated', true);
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || p || '","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', p, true);
END $$;
-- run one statement, keep the answer or the error text
CREATE OR REPLACE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE p_sql INTO r;
  RETURN coalesce(r, 'null');
EXCEPTION WHEN others THEN
  RETURN 'ERR:' || sqlerrm;
END $$;
CREATE TEMP TABLE r (k text, v text);
CREATE TEMP TABLE ids (k text PRIMARY KEY, v text);
SELECT set_config('pn.v', '00000000-0000-4000-8000-0000000510a1', true), set_config('pn.m', '00000000-0000-4000-8000-0000000510a2', true),
       set_config('pn.k', '00000000-0000-4000-8000-0000000510a4', true), set_config('pn.u', '00000000-0000-4000-8000-0000000510a5', true);

-- group: V makes it, K and M join
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO ids SELECT 'G', (public.create_group('GrpS510', 'VicS510')::jsonb) ->> 'id';
INSERT INTO ids SELECT 'CODE', code FROM public.groups WHERE id = (SELECT v::uuid FROM ids WHERE k = 'G');
SELECT pg_temp.as_u(current_setting('pn.k'));
SELECT public.join_group((SELECT v FROM ids WHERE k = 'CODE'), 'KlotS510') IS NOT NULL AS joined_k \g /dev/null
SELECT pg_temp.as_u(current_setting('pn.m'));
SELECT public.join_group((SELECT v FROM ids WHERE k = 'CODE'), 'MateS510') IS NOT NULL AS joined_m \g /dev/null
INSERT INTO ids SELECT 'KK', public.olnu_chief_k((SELECT v::uuid FROM ids WHERE k = 'G'), current_setting('pn.k')::uuid);
INSERT INTO ids SELECT 'VK', public.olnu_chief_k((SELECT v::uuid FROM ids WHERE k = 'G'), current_setting('pn.v')::uuid);
INSERT INTO ids SELECT 'MK', public.olnu_chief_k((SELECT v::uuid FROM ids WHERE k = 'G'), current_setting('pn.m')::uuid);

-- V blocks K (full block)
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO r SELECT 'block', pg_temp.try(format($q$select public.block_user('person', null, %L::uuid, %L, true)::text$q$,
  (SELECT v FROM ids WHERE k = 'G'), (SELECT v FROM ids WHERE k = 'KK')));
SELECT 'setup: V blocked K', v !~ '^ERR', v FROM r WHERE k = 'block';

-- 1. Hitta: V shares with groups; M asks, V answers with an exact point
INSERT INTO r SELECT 'share', pg_temp.try($q$select public.set_find_share(true, false)::text$q$);
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'm_req', pg_temp.try(format($q$select public.find_request(%L, 'MateS510')::text$q$,
  'g' || (SELECT v FROM ids WHERE k = 'G') || ':' || (SELECT v FROM ids WHERE k = 'VK')));
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO r SELECT 'v_ping', pg_temp.try(format($q$select public.find_ping(%L, 68.42777, 18.62777, 5)::text$q$,
  'g' || (SELECT v FROM ids WHERE k = 'G') || ':' || (SELECT v FROM ids WHERE k = 'MK')));
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'm_ping', pg_temp.try(format($q$select public.find_ping(%L, 68.36, 18.80, 5)::text$q$,
  'g' || (SELECT v FROM ids WHERE k = 'G') || ':' || (SELECT v FROM ids WHERE k = 'VK')));
SELECT 'control: mate M finds V (exact point)', v ~ '68\.42777', left(v, 160) FROM r WHERE k = 'm_ping';
SELECT pg_temp.as_u(current_setting('pn.k'));
INSERT INTO r SELECT 'k_req', pg_temp.try(format($q$select public.find_request(%L, 'KlotS510')::text$q$,
  'g' || (SELECT v FROM ids WHERE k = 'G') || ':' || (SELECT v FROM ids WHERE k = 'VK')));
INSERT INTO r SELECT 'k_ping', pg_temp.try(format($q$select public.find_ping(%L, 68.36, 18.80, 5)::text$q$,
  'g' || (SELECT v FROM ids WHERE k = 'G') || ':' || (SELECT v FROM ids WHERE k = 'VK')));
SELECT 'block: K cannot ask to find V', v ~ '^ERR', left(v, 160) FROM r WHERE k = 'k_req';
SELECT 'block: K never gets V''s position (find_ping)', v !~ '68\.42777', left(v, 160) FROM r WHERE k = 'k_ping';

-- 2. Följ mig hem: V starts a walk for the group AFTER the block
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO r SELECT 'walk', pg_temp.try(format($q$select public.walk_start(68.44331, 18.64331, '{}', array[%L::uuid], %L::uuid, 68.42111, 18.62311, 10, 'VicS510')::text$q$,
  (SELECT v FROM ids WHERE k = 'G'), (SELECT v FROM ids WHERE k = 'G')));
SELECT 'setup: V walk started', v !~ '^ERR', left(v, 120) FROM r WHERE k = 'walk';
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'm_walk', pg_temp.try($q$select public.walk_poll()::text$q$);
SELECT 'control: M sees V''s walk', v ~ '68\.42111', left(v, 120) FROM r WHERE k = 'm_walk';
SELECT pg_temp.as_u(current_setting('pn.k'));
INSERT INTO r SELECT 'k_walk', pg_temp.try($q$select public.walk_poll()::text$q$);
SELECT 'block: K does not see V''s walk (live point + home)', v !~ '68\.42111|68\.443|VicS510' AND v !~ '^ERR', left(v, 160) FROM r WHERE k = 'k_walk';
SELECT 'block: K is not a viewer of the new walk', NOT (current_setting('pn.k')::uuid = ANY (w.viewers)), array_length(w.viewers, 1)::text
  FROM public.walks w WHERE w.user_id = current_setting('pn.v')::uuid AND w.ended_at IS NULL;

-- 3. Invite to the group after the block
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO r SELECT 'inv', pg_temp.try(format($q$select public.invite_create('InviteS510', now() + interval '2 hours', '{}', array[%L::uuid], null, 'PlaceS510', 68.4255, 18.6255, 'NoteS510')::text$q$,
  (SELECT v FROM ids WHERE k = 'G')));
SELECT 'setup: V invite made', v !~ '^ERR', left(v, 120) FROM r WHERE k = 'inv';
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'm_inv', pg_temp.try($q$select public.my_invites()::text$q$);
SELECT 'control: M sees V''s invite', v ~ 'InviteS510', left(v, 80) FROM r WHERE k = 'm_inv';
SELECT pg_temp.as_u(current_setting('pn.k'));
INSERT INTO r SELECT 'k_inv', pg_temp.try($q$select public.my_invites()::text$q$);
SELECT 'block: K does not get V''s invite (place, time)', v !~ 'InviteS510|PlaceS510' AND v !~ '^ERR', left(v, 160) FROM r WHERE k = 'k_inv';

-- 4. Gänget departure
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO r SELECT 'dep', pg_temp.try(format($q$select public.crew_dep_set(%L::uuid, now() + interval '1 hour', 'osm:s510bar', 'BarS510', 68.42151, 18.62351)::text$q$,
  (SELECT v FROM ids WHERE k = 'G')));
SELECT 'setup: V departure set', v !~ '^ERR', left(v, 120) FROM r WHERE k = 'dep';
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'm_dep', pg_temp.try(format($q$select public.crew_group(%L::uuid)::text$q$, (SELECT v FROM ids WHERE k = 'G')));
SELECT 'control: M sees V''s departure', v ~ 'BarS510', left(v, 80) FROM r WHERE k = 'm_dep';
SELECT pg_temp.as_u(current_setting('pn.k'));
INSERT INTO r SELECT 'k_dep', pg_temp.try(format($q$select public.crew_group(%L::uuid)::text$q$, (SELECT v FROM ids WHERE k = 'G')));
SELECT 'block: K does not see V''s departure (bar + time)', v !~ 'BarS510' AND v !~ '^ERR', left(v, 160) FROM r WHERE k = 'k_dep';

-- 5. Ghost guard (regression, passes on old code too): V's ghost beer is not on M's map
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO r SELECT 'ghost', pg_temp.try($q$select public.post_beer_v2(68.42999, 18.62999, true, true)::text$q$);
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'm_live', pg_temp.try($q$select json_agg(t)::text from public.live_beers() t$q$);
INSERT INTO r SELECT 'm_poll', pg_temp.try($q$select public.poll_v2(68.0, 18.0, 69.0, 19.5, null, true)::text$q$);
SELECT 'ghost: M never sees V''s ghost point', bool_and(v !~ '68\.42999|18\.62999'), string_agg(left(v, 60), ' / ') FROM r WHERE k IN ('m_live', 'm_poll');

-- 6. Group code guessing: one IP with 60 failed codes in this 10-minute slot is slowed down, whatever the user id
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.51.0.9"}', true);
SELECT pg_temp.as_u(current_setting('pn.u'));
INSERT INTO r SELECT 'ip1', pg_temp.try($q$select public.join_preview('QQQQQ1')::text$q$);
SELECT 'ip: a failed code is counted per IP', coalesce((SELECT bad FROM public.gw_link_hits WHERE k = 'j510:' || md5('olnu-gw|10.51.0.9')), 0) = 1,
       coalesce((SELECT bad FROM public.gw_link_hits WHERE k = 'j510:' || md5('olnu-gw|10.51.0.9'))::text, 'no row');
UPDATE public.gw_link_hits SET bad = 60 WHERE k = 'j510:' || md5('olnu-gw|10.51.0.9');
INSERT INTO public.gw_link_hits (k, slot, n, bad)
  SELECT 'j510:' || md5('olnu-gw|10.51.0.9'), floor(extract(epoch from now()) / 600)::bigint, 60, 60
  WHERE NOT EXISTS (SELECT 1 FROM public.gw_link_hits WHERE k = 'j510:' || md5('olnu-gw|10.51.0.9'));
INSERT INTO r SELECT 'ip_prev', pg_temp.try($q$select public.join_preview('QQQQQ2')::text$q$);
INSERT INTO r SELECT 'ip_join', pg_temp.try(format($q$select public.join_group(%L, 'UU')::text$q$, (SELECT v FROM ids WHERE k = 'CODE')));
SELECT 'ip: join_preview says slow_down after 60 fails from one IP', v ~ 'slow_down', v FROM r WHERE k = 'ip_prev';
SELECT 'ip: join_group says slow_down after 60 fails from one IP', v ~ 'slow_down', left(v, 120) FROM r WHERE k = 'ip_join';
SELECT set_config('request.headers', '{"cf-connecting-ip":"10.51.0.10"}', true);
INSERT INTO r SELECT 'ip_other', pg_temp.try($q$select public.join_preview('QQQQQ3')::text$q$);
SELECT 'ip: another IP is not slowed down', v !~ 'slow_down', v FROM r WHERE k = 'ip_other';
SELECT set_config('request.headers', '', true);

-- 7. Age gate on the server: U says born 2012 → no beer, no group join; M (no answer) can still post
SELECT pg_temp.as_u(current_setting('pn.u'));
INSERT INTO r SELECT 'age', pg_temp.try($q$select public.set_age_ok(2012, null)::text$q$);
SELECT 'setup: U answered under 18', v ~ '"age_ok": false', v FROM r WHERE k = 'age';
INSERT INTO r SELECT 'u_beer', pg_temp.try($q$select public.post_beer_v2(68.40, 18.60, true, false)::text$q$);
INSERT INTO r SELECT 'u_join', pg_temp.try(format($q$select public.join_group(%L, 'UU')::text$q$, (SELECT v FROM ids WHERE k = 'CODE')));
SELECT 'age: under-18 cannot post a beer', v ~ 'age_blocked', left(v, 120) FROM r WHERE k = 'u_beer';
SELECT 'age: under-18 cannot join a group', v ~ 'age_blocked', left(v, 120) FROM r WHERE k = 'u_join';
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'm_beer', pg_temp.try($q$select public.post_beer_v2(68.36111, 18.82221, true, false)::text$q$);
SELECT 'control: M (no age answer) can post a beer', v ~ '"accepted": true', left(v, 120) FROM r WHERE k = 'm_beer';
ROLLBACK;
