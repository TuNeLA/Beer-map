-- Smoke test of core RPCs as seeded fake user 1, with the real API role "authenticated".
-- Everything runs in one transaction and is rolled back. Each line prints "name|ok|detail".
BEGIN;
SELECT set_config('smoke.gid', (SELECT id::text FROM public.groups WHERE name = 'Testgänget' ORDER BY created_at LIMIT 1), true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT 'poll_v2', (r::jsonb ? 'beers' OR r IS NOT NULL), left(r::text, 120) FROM (SELECT public.poll_v2(68.0, 18.0, 69.0, 19.5) AS r) x;
SELECT 'poll_public', r IS NOT NULL, left(r::text, 120) FROM (SELECT public.poll_public(68.0, 18.0, 69.0, 19.5) AS r) x;
SELECT 'my_groups', count(*) >= 1, string_agg(name || ':' || member_count, ',') FROM public.my_groups();
SELECT 'group_status_v3', count(*) = 3, string_agg(name, ',') FROM public.group_status_v3(current_setting('smoke.gid')::uuid);
SELECT 'stop_beer', true, coalesce(public.stop_beer()::text, 'void');
SELECT 'post_beer_v2', true, left(public.post_beer_v2(68.352, 18.803, false, false)::text, 160);
SELECT 'undo_beer', true, left(public.undo_beer()::text, 120);
SELECT 'check_in', (r->>'ok') IS NOT NULL, left(r::text, 120) FROM (SELECT public.check_in('test-bar-2', 'Smoketestbaren', 68.3502, 18.8004) AS r) x;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT 'anon_cannot_read_tables', NOT has_table_privilege('anon', 'public.beers', 'SELECT'), 'beers SELECT for anon';
ROLLBACK;
