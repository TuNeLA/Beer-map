-- Seed data for STAGING tests. Fresh fake users and groups only. No real data.
-- Test zone: 68.35 / 18.80 (far north, no real users there). All users are marked test=true,
-- so public.olnu_is_test_uid() skips them in owner stats.
-- Runs as the database owner. RPCs are called with request.jwt.claims set to each fake user.

-- 1. Fake anonymous users (fixed ids, so tests can find them)
INSERT INTO auth.users (id, aud, role, is_anonymous, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
SELECT ('00000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', true,
       jsonb_build_object('test', 'true'), jsonb_build_object('provider', 'anonymous', 'providers', jsonb_build_array('anonymous')),
       now(), now()
FROM generate_series(1, 4) AS n
ON CONFLICT (id) DO NOTHING;

-- 2. Actions as the fake users, through the real RPCs
CREATE OR REPLACE FUNCTION pg_temp.as_user(n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-00000000000' || n, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000' || n, true);
$$;

DO $$
DECLARE
  v_g json;
  v_code text;
BEGIN
  PERFORM pg_temp.as_user(1);
  PERFORM public.accept_terms(1);
  v_g := public.create_group('Testgänget', 'Test Ett');
  v_code := v_g->>'code';
  PERFORM public.post_beer_v2(68.3500, 18.8000, true, false);

  PERFORM pg_temp.as_user(2);
  PERFORM public.accept_terms(1);
  PERFORM public.join_group(v_code, 'Test Två');
  PERFORM public.post_beer_v2(68.3510, 18.8020, false, false);

  PERFORM pg_temp.as_user(3);
  PERFORM public.accept_terms(1);
  PERFORM public.join_group(v_code, 'Test Tre');
  PERFORM public.check_in('test-bar-1', 'Testbaren', 68.3505, 18.8010);

  PERFORM pg_temp.as_user(4);
  PERFORM public.accept_terms(1);
  PERFORM public.create_group('Ensam testgrupp', 'Test Fyra');

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'seed ok, group code %', v_code;
END $$;
