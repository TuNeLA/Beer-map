-- 0466 (lane fixP, N-02): rpc_bundle2 takes the chat reads + moments_poll. LOCAL / staging copy only. One transaction,
-- ROLLBACK at the end. Runs 0466 itself twice (2nd = skip). Needs: the schema + 0465 (and 0480 or not: both work).
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0466_fixp_chat_bundle.sql -f supabase/tests/fixp-0466.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
INSERT INTO auth.users (id, aud, role) VALUES ('00000000-0000-4000-8000-000000046601', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000046602', 'authenticated', 'authenticated'), ('00000000-0000-4000-8000-000000046603', 'authenticated', 'authenticated');
INSERT INTO public.groups (id, name, code, created_by) VALUES ('00000000-0000-4000-8000-0000000466a0', 'Chat 0466', 'CHT466', '00000000-0000-4000-8000-000000046601');
INSERT INTO public.group_members (group_id, user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000466a0', '00000000-0000-4000-8000-000000046601', 'Jag'),
  ('00000000-0000-4000-8000-0000000466a0', '00000000-0000-4000-8000-000000046602', 'Kompis');
INSERT INTO public.group_msgs (group_id, user_id, body, expires_at) VALUES
  ('00000000-0000-4000-8000-0000000466a0', '00000000-0000-4000-8000-000000046602', 'Var é ni?', now() + interval '6 hours'),
  ('00000000-0000-4000-8000-0000000466a0', '00000000-0000-4000-8000-000000046601', 'Pitchers', now() + interval '6 hours');
CREATE OR REPLACE FUNCTION pg_temp.as_u(u text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || u || '","role":"authenticated","is_anonymous":true}', true);
  PERFORM set_config('request.jwt.claim.sub', u, true);
END $$;
CREATE TEMP TABLE calls AS SELECT '[
  {"k":"m","n":"group_msgs","a":{"p_group_id":"00000000-0000-4000-8000-0000000466a0","p_after_id":0}},
  {"k":"p","n":"group_photos","a":{"p_group_id":"00000000-0000-4000-8000-0000000466a0","p_after_id":0}},
  {"k":"r","n":"msg_reacts","a":{"p_group_id":"00000000-0000-4000-8000-0000000466a0"}},
  {"k":"v","n":"group_voices","a":{"p_group_id":"00000000-0000-4000-8000-0000000466a0","p_after_id":0}},
  {"k":"s3","n":"group_status_v3","a":{"p_group_id":"00000000-0000-4000-8000-0000000466a0"}},
  {"k":"s2","n":"group_status_v2","a":{"p_group_id":"00000000-0000-4000-8000-0000000466a0"}},
  {"k":"mo","n":"moments_poll","a":{}}]'::jsonb AS j;
GRANT SELECT ON calls TO authenticated;
SELECT pg_temp.as_u('00000000-0000-4000-8000-000000046601');
SELECT 'before: 0465 on the list', position('load0465' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0, '';
WITH r AS (SELECT public.rpc_bundle2((SELECT j FROM calls)) AS j)
SELECT 'before: group_photos not_bundled', (j -> 'p' -> 'e' ->> 'message') = 'not_bundled', left((j -> 'p')::text, 80) FROM r
UNION ALL SELECT 'before: moments_poll not_bundled', (j -> 'mo' -> 'e' ->> 'message') = 'not_bundled', '' FROM r
UNION ALL SELECT 'before: group_msgs answered (0465)', (j -> 'm' ? 'd'), '' FROM r;
\i :mig
\i :mig
SELECT 'marker fixp0466', position('fixp0466' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0, '';
SELECT 'olnu_fixp_patch not executable by users', NOT has_function_privilege('authenticated', 'public.olnu_fixp_patch(regprocedure, text, text[], text[])', 'execute')
   AND NOT has_function_privilege('anon', 'public.olnu_fixp_patch(regprocedure, text, text[], text[])', 'execute'), '';
SELECT 'rpc_bundle2 stays SECURITY INVOKER', NOT prosecdef, '' FROM pg_proc WHERE oid = 'public.rpc_bundle2(jsonb)'::regprocedure;
SELECT 'rpc_bundle2: anon cannot run it', NOT has_function_privilege('anon', 'public.rpc_bundle2(jsonb)', 'execute'), '';
SELECT 'old names + 0465 names still on the list', position('''golden_horse''' in d) > 0 AND position('''game_poll''' in d) > 0
   AND position('''my_night_report''' in d) > 0 AND position('''poll_v2''' in d) > 0, ''
  FROM (SELECT pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure) d) x;
SELECT 'cap stays 40', position('jsonb_array_length(p_calls) > 40' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0, '';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_u('00000000-0000-4000-8000-000000046601');
WITH r AS (SELECT public.rpc_bundle2((SELECT j FROM calls)) AS j)
SELECT 'after: group_msgs = direct call', (j -> 'm' -> 'd') = (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM public.group_msgs('00000000-0000-4000-8000-0000000466a0', 0) x), left((j -> 'm')::text, 100) FROM r
UNION ALL SELECT 'after: group_photos answered', (j -> 'p' ? 'd') AND jsonb_typeof(j -> 'p' -> 'd') = 'array', left((j -> 'p')::text, 80) FROM r
UNION ALL SELECT 'after: msg_reacts answered', (j -> 'r' ? 'd'), left((j -> 'r')::text, 80) FROM r
UNION ALL SELECT 'after: group_voices answered', (j -> 'v' ? 'd'), left((j -> 'v')::text, 80) FROM r
UNION ALL SELECT 'after: group_status_v3 = direct call', (j -> 's3' -> 'd') = (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM public.group_status_v3('00000000-0000-4000-8000-0000000466a0') x), left((j -> 's3')::text, 100) FROM r
UNION ALL SELECT 'after: group_status_v2 answered', (j -> 's2' ? 'd'), '' FROM r
UNION ALL SELECT 'after: moments_poll answered', (j -> 'mo' ? 'd'), left((j -> 'mo')::text, 100) FROM r;
-- a stranger: the same not_member answer as a direct call (the membership check is the function's own)
SELECT pg_temp.as_u('00000000-0000-4000-8000-000000046603');
WITH r AS (SELECT public.rpc_bundle2((SELECT j FROM calls)) AS j)
SELECT 'stranger: group_photos not_member', (j -> 'p' -> 'e' ->> 'message') ~ 'not_member', left((j -> 'p')::text, 80) FROM r
UNION ALL SELECT 'stranger: msg_reacts no rows of the group', coalesce(j -> 'r' -> 'e' ->> 'message' ~ 'not_member', false) OR (j -> 'r' -> 'd') = '[]'::jsonb, left((j -> 'r')::text, 80) FROM r
UNION ALL SELECT 'stranger: group_msgs not_member', (j -> 'm' -> 'e' ->> 'message') ~ 'not_member', '' FROM r;
-- unknown name / wrong argument: still refused
WITH r AS (SELECT public.rpc_bundle2('[{"k":"x","n":"post_group_msg","a":{"p_group_id":"00000000-0000-4000-8000-0000000466a0","p_body":"x"}},{"k":"y","n":"group_photos","a":{"p_nope":1}}]'::jsonb) AS j)
SELECT 'a write (post_group_msg) is still not_bundled', (j -> 'x' -> 'e' ->> 'message') = 'not_bundled', '' FROM r
UNION ALL SELECT 'a wrong argument name is still refused', (j -> 'y' -> 'e' ->> 'message') = 'not_bundled', '' FROM r;
RESET ROLE;
SELECT 'no message was written', (SELECT count(*) FROM public.group_msgs WHERE group_id = '00000000-0000-4000-8000-0000000466a0') = 2, '';
ROLLBACK;
