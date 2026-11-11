-- 0466 FIXP · one chat tick = one request (test teams round 2, N-02; lane fixP). OWNER-RUN, AFTER 0465 (and 0430/0431).
-- Additive: no statement removes rows or objects.
-- Why: an open group chat sent 20–30 requests a minute: group_msgs, group_photos, msg_reacts, group_voices and
-- group_status_v3 each had their own timer and went alone. The new client (app.js "chat lane") asks them together in ONE
-- rpc_bundle2 per chat tick (7 s → 15 s → 30 s). group_msgs is on the list since 0465; this file adds the other chat reads
-- and moments_poll (it then rides the map-poll bundle; the client never asks it ahead, because it can open a round).
-- Before this file runs, the server answers 'not_bundled' for these names and the client sends them alone, once per tick.
-- The functions themselves do not change (each one checks the membership itself; rpc_bundle2 is SECURITY INVOKER, so each
-- call runs with the caller's rights and auth.uid(), exactly as a direct call).
-- Method: the same anchor patch as 0149, 0403, 0431, 0465 and 0480. It reads the DEPLOYED definition and makes one exact
-- text replacement at the END of the 0465 name list. The anchor must occur exactly once, or the patch stops with an error
-- and nothing changes (so it stops when 0465 has not run). A definition that already has the marker 'fixp0466' is skipped,
-- so the file is safe to run twice. 0480 patches the START of the list: both orders work.
-- Checked on a local copy (schema snapshot + migrations, Postgres 16): before 0465 = stops, nothing changed; 0465 → 0466
-- (twice, 2nd = skip); 0480 before / after; a bundle with the 6 names + group_msgs answers each one like a direct call
-- (supabase/tests/fixp-0466.test.sql).
-- Check after the run (expect t):
--   select position('fixp0466' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0;

create or replace function public.olnu_fixp_patch(p_fn regprocedure, p_marker text, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  i int; n int;
begin
  if position(p_marker in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_fixp_patch %: anchor % found % times (run 0465 first)', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  if position(p_marker in v_def) = 0 then
    raise exception 'olnu_fixp_patch %: marker % missing after the patch', p_fn::text, p_marker;
  end if;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_fixp_patch(regprocedure, text, text[], text[]) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_fixp_patch(regprocedure, text, text[], text[]) from anon, authenticated';
  end if;
end $g$;

-- rpc_bundle2: + the chat reads and moments_poll at the END of the 0465 list (the cap stays 40).
select public.olnu_fixp_patch('public.rpc_bundle2(jsonb)', '/*fixp0466*/',
  array[$a$'walk_timer_tick', 'after_report2', 'my_night_report'];$a$],
  array[$a$'walk_timer_tick', 'after_report2', 'my_night_report',
                     /*fixp0466*/ 'group_photos', 'msg_reacts', 'group_voices', 'group_status_v3', 'group_status_v2',
                     'moments_poll'];$a$]);
