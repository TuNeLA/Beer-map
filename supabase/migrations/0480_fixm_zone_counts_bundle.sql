-- 0480 FIXM · the top bar count rides the poll bundle (test teams 11 Nov, T-15; lane fixM). OWNER-RUN, AFTER 0430/0431
-- (before or after 0465: either order works). Additive: no statement removes rows or objects.
-- Why: the top bar pill now shows the kommun under the map centre and its count from zone_counts (0221) at every zoom
-- (before: only when zoomed out). The client asks zone_counts at most once a minute. app.js has it on its BUNDLE list,
-- so it goes in the same rpc_bundle2 request as the other background calls: no extra HTTP request (lane perf budget).
-- This file puts 'zone_counts' on the rpc_bundle2 name list. Before this file runs, the server answers 'not_bundled' for it
-- and the client sends it alone (one small request a minute), as today's zoomed-out map does.
-- zone_counts itself does not change (security definer, anon + authenticated, a 60 s server cache).
-- Method: the same anchor patch as 0149, 0403, 0431 and 0465. It reads the DEPLOYED definition and makes one exact text
-- replacement. The anchor must occur exactly once, or the patch stops with an error and nothing changes. A definition that
-- already has the marker 'fixm0480' is skipped, so the file is safe to run twice.
-- Checked on a local copy (schema snapshot + live migrations, Postgres 16): without 0465, 0465 then 0480, 0480 then 0465,
-- each run twice (2nd = skip); a bundle with zone_counts + my_status answers both (supabase/tests/fixm-0480.test.sql).
-- Check after the run (expect t):
--   select position('fixm0480' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0;

create or replace function public.olnu_fixm_patch(p_fn regprocedure, p_marker text, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');   -- CR-safe (0501, like 0436 olnu_sec_patch)
  i int; n int;
begin
  p_old := array(select replace(x, chr(13), '') from unnest(p_old) with ordinality u(x, o) order by o);
  p_new := array(select replace(x, chr(13), '') from unnest(p_new) with ordinality u(x, o) order by o);
  p_marker := replace(p_marker, chr(13), '');
  if position(p_marker in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_fixm_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  if position(p_marker in v_def) = 0 then
    raise exception 'olnu_fixm_patch %: marker % missing after the patch', p_fn::text, p_marker;
  end if;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_fixm_patch(regprocedure, text, text[], text[]) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_fixm_patch(regprocedure, text, text[], text[]) from anon, authenticated';
  end if;
end $g$;

-- rpc_bundle2: + 'zone_counts' at the START of the name list. The 0465 anchor (the end of the list) stays as it is, so
-- 0465 and 0480 can run in either order.
select public.olnu_fixm_patch('public.rpc_bundle2(jsonb)', '/*fixm0480*/',
  array[$a$ok text[] := array['game_poll',$a$],
  array[$a$ok text[] := array[/*fixm0480*/ 'zone_counts', 'game_poll',$a$]);
