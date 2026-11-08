-- 0295 — rpc_bundle: the app's start-up / background polls in ONE request (cln, owner logs 2026-11-08).
-- Additive only: 1 new function. Nothing old changes; old clients never call it.
--   rpc_bundle(p_names text[]) → {<name>: {d: <the function's own answer>} | {e: {message, code}}}
-- Each name runs as its own call (SECURITY INVOKER: the caller's rights and auth.uid(), exactly like a separate RPC) in its
-- own sub-transaction: an error in one (not_member, slow_down …) is returned for that name only, the others go on.
-- Only the whitelisted polls below (no arguments; safety_state with p_seen = false). Max 16 names.

create or replace function public.rpc_bundle(p_names text[])
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  n text;
  v jsonb;
  v_out jsonb := '{}'::jsonb;
  ok text[] := array['game_poll', 'gang_poll', 'skal_poll', 'film_poll', 'ceremony_poll', 'walk_poll', 'my_invites',
                     'helg_state', 'my_status', 'my_inbox', 'my_dms', 'pickup_poll', 'safety_state'];
begin
  if p_names is null or cardinality(p_names) > 16 then raise exception 'invalid_names'; end if;
  foreach n in array p_names loop
    if n is null or v_out ? n then continue; end if;
    if not (n = any(ok)) then
      v_out := v_out || jsonb_build_object(n, jsonb_build_object('e', jsonb_build_object('message', 'not_bundled', 'code', 'not_bundled')));
      continue;
    end if;
    begin
      if n = 'safety_state' then
        v := to_jsonb(public.safety_state(false));
      else
        execute format('select to_jsonb(public.%I())', n) into v;
      end if;
      v_out := v_out || jsonb_build_object(n, jsonb_build_object('d', v));
    exception when others then
      v_out := v_out || jsonb_build_object(n, jsonb_build_object('e', jsonb_build_object('message', sqlerrm, 'code', sqlstate)));
    end;
  end loop;
  return v_out;
end; $$;
revoke all on function public.rpc_bundle(text[]) from public, anon;
grant execute on function public.rpc_bundle(text[]) to authenticated;
