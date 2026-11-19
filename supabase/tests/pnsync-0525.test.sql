-- 0525 (lane srvsync, PLAN A7): pn_sync = rpc_bundle2 with versions (only what changed comes back).
-- LOCAL / CI copy only. One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- Run it on 2 databases: rh_pre (= before 0500: no rpc_bundle_allow table, like LIVE today) and rh_lf (all files).
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0525_pn_sync.sql -f supabase/tests/pnsync-0525.test.sql
-- Old code proof: -v mig=/dev/null -> every pn_sync line prints |f| (no function).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "pnsync-0525 done|t|".
-- now() is the same inside one transaction, so poll_v2 server_time does not change between two calls here.
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES
  ('00000000-0000-4000-8000-0000000525a1', 'authenticated', 'authenticated', true);
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p IS NULL THEN '' ELSE '{"sub":"' || p || '","role":"authenticated"}' END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p, ''), true);
END $$;
CREATE TEMP TABLE r (k text, v jsonb);
-- a pn_sync call that never stops the test (an error = {"err": message})
CREATE OR REPLACE FUNCTION pg_temp.sync(p_calls jsonb, p_have jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF to_regprocedure('public.pn_sync(jsonb,jsonb)') IS NULL THEN RETURN jsonb_build_object('err', 'no pn_sync'); END IF;
  RETURN public.pn_sync(p_calls, p_have);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('err', sqlerrm);
END $$;
-- the phone side: the value the phone has after an entry (old = what it had before)
CREATE OR REPLACE FUNCTION pg_temp.take(old jsonb, e jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN e ? 's' THEN old
              WHEN e ? 'p' THEN (SELECT coalesce(jsonb_object_agg(h.key, CASE WHEN (e -> 'd') ? h.key THEN e -> 'd' -> h.key ELSE old -> h.key END), '{}'::jsonb)
                                   FROM jsonb_each(e -> 'h') h)
              ELSE e -> 'd' END;
$$;
INSERT INTO public.bars_lite (id, name, lat, lng, type, active) VALUES ('t525-bar', 'Bar 525', 60.15000, 15.19000, 'bar', true)
  ON CONFLICT DO NOTHING;
SELECT pg_temp.as_u('00000000-0000-4000-8000-0000000525a1');
INSERT INTO r SELECT 'calls', jsonb_build_array(
  jsonb_build_object('k', 'poll_v2|v', 'n', 'poll_v2', 'a', jsonb_build_object('p_min_lat', 60.10, 'p_min_lng', 15.10, 'p_max_lat', 60.20, 'p_max_lng', 15.30, 'p_since', null, 'p_heat', false)),
  jsonb_build_object('k', 'my_groups|{}', 'n', 'my_groups', 'a', '{}'::jsonb),
  jsonb_build_object('k', 'off|{}', 'n', 'set_display_name', 'a', jsonb_build_object('p_name', 'X')),
  jsonb_build_object('k', 'self|{}', 'n', 'pn_sync', 'a', '{}'::jsonb),
  jsonb_build_object('k', 'b2|{}', 'n', 'rpc_bundle2', 'a', '{}'::jsonb));

-- 1. a first call: everything in full, with hashes
INSERT INTO r SELECT 'a1', pg_temp.sync((SELECT v FROM r WHERE k = 'calls'), '{}'::jsonb);
SELECT 'first: answer shape {pn: 1, r: {...}}', coalesce(((v ->> 'pn') = '1' AND jsonb_typeof(v -> 'r') = 'object'), false), left(v::text, 200) FROM r WHERE k = 'a1';
SELECT 'first: poll_v2 in full + field hashes', coalesce(((v -> 'r' -> 'poll_v2|v') ? 'd' AND jsonb_typeof(v -> 'r' -> 'poll_v2|v' -> 'h') = 'object' AND NOT (v -> 'r' -> 'poll_v2|v') ? 'p'), false),
  left((v -> 'r' -> 'poll_v2|v')::text, 200) FROM r WHERE k = 'a1';
SELECT 'first: poll_v2 d = a direct poll_v2 call', coalesce(((v -> 'r' -> 'poll_v2|v' -> 'd') = public.poll_v2(60.10, 15.10, 60.20, 15.30, null, false)::jsonb), false), '' FROM r WHERE k = 'a1';
SELECT 'first: my_groups (an array) in full + one hash', coalesce((jsonb_typeof(v -> 'r' -> 'my_groups|{}' -> 'h') = 'string' AND (v -> 'r' -> 'my_groups|{}') ? 'd'), false),
  coalesce((v -> 'r' -> 'my_groups|{}')::text, 'null') FROM r WHERE k = 'a1';
SELECT 'first: a name off the list = not_bundled (a write is never run)', coalesce(((v -> 'r' -> 'off|{}' -> 'e' ->> 'message') = 'not_bundled'), false), coalesce((v -> 'r' -> 'off|{}')::text, 'null') FROM r WHERE k = 'a1';
SELECT 'first: pn_sync and rpc_bundle2 cannot be called inside', coalesce(((v -> 'r' -> 'self|{}' -> 'e' ->> 'message') = 'not_bundled' AND (v -> 'r' -> 'b2|{}' -> 'e' ->> 'message') = 'not_bundled'), false), '' FROM r WHERE k = 'a1';

-- 2. the same call with what the phone has: nothing changed -> {"s": 1} only
INSERT INTO r SELECT 'have1', (SELECT jsonb_object_agg(e.key, e.value -> 'h') FROM jsonb_each(v -> 'r') e WHERE e.value ? 'h') FROM r WHERE k = 'a1';
INSERT INTO r SELECT 'a2', pg_temp.sync((SELECT v FROM r WHERE k = 'calls'), (SELECT v FROM r WHERE k = 'have1'));
SELECT 'same: poll_v2 = {s: 1}', coalesce(((v -> 'r' -> 'poll_v2|v') = '{"s": 1}'::jsonb), false), coalesce(left((v -> 'r' -> 'poll_v2|v')::text, 200), 'null') FROM r WHERE k = 'a2';
SELECT 'same: my_groups = {s: 1}', coalesce(((v -> 'r' -> 'my_groups|{}') = '{"s": 1}'::jsonb), false), coalesce((v -> 'r' -> 'my_groups|{}')::text, 'null') FROM r WHERE k = 'a2';
SELECT 'same: the 2nd answer is much smaller', coalesce((length(a2.v::text) * 3 < length(a1.v::text)), false), length(a2.v::text) || ' vs ' || length(a1.v::text)
  FROM r a1, r a2 WHERE a1.k = 'a1' AND a2.k = 'a2';

-- 3. a beer: only the fields that changed come back (pins, me, live_total ...), never server_time / bbox
SELECT (public.post_beer_v2(60.15000, 15.19000, true, false)::jsonb ->> 'id') IS NOT NULL \g /dev/null
INSERT INTO r SELECT 'a3', pg_temp.sync((SELECT v FROM r WHERE k = 'calls'), (SELECT v FROM r WHERE k = 'have1'));
SELECT 'changed: poll_v2 is a part answer (p = 1)', coalesce(((v -> 'r' -> 'poll_v2|v' ->> 'p') = '1'), false), coalesce(left((v -> 'r' -> 'poll_v2|v')::text, 200), 'null') FROM r WHERE k = 'a3';
SELECT 'changed: pins and me are in it', coalesce(((v -> 'r' -> 'poll_v2|v' -> 'd') ? 'pins' AND (v -> 'r' -> 'poll_v2|v' -> 'd') ? 'me'), false), (SELECT string_agg(x, ',') FROM jsonb_object_keys(v -> 'r' -> 'poll_v2|v' -> 'd') x) FROM r WHERE k = 'a3';
SELECT 'changed: bbox and server_time are not in it', coalesce((NOT (v -> 'r' -> 'poll_v2|v' -> 'd') ? 'bbox' AND NOT (v -> 'r' -> 'poll_v2|v' -> 'd') ? 'server_time'), false), '' FROM r WHERE k = 'a3';
SELECT 'changed: old value + part answer = a direct poll_v2 call', coalesce((pg_temp.take(a1.v -> 'r' -> 'poll_v2|v' -> 'd', a3.v -> 'r' -> 'poll_v2|v') = public.poll_v2(60.10, 15.10, 60.20, 15.30, null, false)::jsonb), false), ''
  FROM r a1, r a3 WHERE a1.k = 'a1' AND a3.k = 'a3';
SELECT 'changed: my_groups did not change = {s: 1}', coalesce(((v -> 'r' -> 'my_groups|{}') = '{"s": 1}'::jsonb), false), coalesce((v -> 'r' -> 'my_groups|{}')::text, 'null') FROM r WHERE k = 'a3';

-- 4. a wrong hash = the full value; a field the phone has that is gone now = not in h
INSERT INTO r SELECT 'a4', pg_temp.sync((SELECT v FROM r WHERE k = 'calls'), '{"my_groups|{}": "nope", "poll_v2|v": {"gone": "x"}}'::jsonb);
SELECT 'wrong hash: my_groups in full', coalesce(((v -> 'r' -> 'my_groups|{}') ? 'd' AND NOT (v -> 'r' -> 'my_groups|{}') ? 's'), false), '' FROM r WHERE k = 'a4';
SELECT 'gone field: not in h (the phone drops it)', coalesce((NOT (v -> 'r' -> 'poll_v2|v' -> 'h') ? 'gone' AND pg_temp.take('{"gone": 1}'::jsonb, v -> 'r' -> 'poll_v2|v') = public.poll_v2(60.10, 15.10, 60.20, 15.30, null, false)::jsonb), false), '' FROM r WHERE k = 'a4';
SELECT 'odd p_have (an array) = full answers', coalesce(((pg_temp.sync((SELECT v FROM r WHERE k = 'calls'), '[1]'::jsonb) -> 'r' -> 'my_groups|{}') ? 'd'), false), '';

-- 5. limits and access
SELECT 'cap: 41 calls = invalid_calls', coalesce((pg_temp.sync((SELECT jsonb_agg(jsonb_build_object('k', 'k' || g, 'n', 'my_groups', 'a', '{}'::jsonb)) FROM generate_series(1, 41) g), '{}'::jsonb) ->> 'err' = 'invalid_calls'), false), '';
SELECT 'cap: 40 calls work', coalesce(((pg_temp.sync((SELECT jsonb_agg(jsonb_build_object('k', 'k' || g, 'n', 'my_groups', 'a', '{}'::jsonb)) FROM generate_series(1, 40) g), '{}'::jsonb) -> 'r') ? 'k40'), false), '';
SELECT pg_temp.as_u(NULL);
SELECT 'auth: no user = not_authenticated', coalesce((pg_temp.sync((SELECT v FROM r WHERE k = 'calls'), '{}'::jsonb) ->> 'err' = 'not_authenticated'), false), '';
SELECT 'grant: anon cannot run pn_sync', coalesce((CASE WHEN to_regprocedure('public.pn_sync(jsonb,jsonb)') IS NULL THEN false ELSE NOT has_function_privilege('anon', 'public.pn_sync(jsonb,jsonb)', 'execute') END), false), '';
SELECT 'grant: public cannot run pn_sync', coalesce((CASE WHEN to_regprocedure('public.pn_sync(jsonb,jsonb)') IS NULL THEN false ELSE NOT EXISTS (
  SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE p.oid = 'public.pn_sync(jsonb,jsonb)'::regprocedure AND x.grantee = 0) END), false), '';
SELECT 'grant: authenticated can run pn_sync', coalesce((CASE WHEN to_regprocedure('public.pn_sync(jsonb,jsonb)') IS NULL THEN false ELSE has_function_privilege('authenticated', 'public.pn_sync(jsonb,jsonb)', 'execute') END), false), '';
SELECT 'grant: pn_sync is SECURITY INVOKER with a fixed search_path', coalesce((CASE WHEN to_regprocedure('public.pn_sync(jsonb,jsonb)') IS NULL THEN false ELSE
  (SELECT NOT p.prosecdef AND p.proconfig::text LIKE '%search_path=public%' FROM pg_proc p WHERE p.oid = 'public.pn_sync(jsonb,jsonb)'::regprocedure) END), false), '';
CREATE OR REPLACE FUNCTION pg_temp.n_allow() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE 'select count(*) from public.rpc_bundle_allow' INTO n; RETURN n; EXCEPTION WHEN others THEN RETURN -1; END $$;
SELECT 'list: rpc_bundle_allow has the 75 names', coalesce((pg_temp.n_allow() >= 75), false), pg_temp.n_allow();
SELECT 'list: rpc_bundle2 was not changed by 0525', coalesce((position('pn_sync' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) = 0), false), '';
SELECT 'pnsync-0525 done', true, '';
ROLLBACK;
