-- 0297 — rpc_bundle2: like rpc_bundle (0295/0296) but each call may carry its own named arguments, so the idle map polls
-- with arguments (crew_poll, near_poll, my_meriter, avatars_for, ikvall_status, home_status …) go in the same request.
-- Additive: 1 new function. The client (cln06) uses rpc_bundle2; rpc_bundle stays for nothing old (no caller needs it).
--   rpc_bundle2(p_calls jsonb) — p_calls = [{k: "<key>", n: "<function>", a: {<p_arg>: value}}] (max 24)
--   → {<key>: {d: <answer>} | {e: {message, code}}}
-- Only whitelisted functions (one overload each); argument names must be the function's own; every value is passed as a
-- quoted literal cast to the argument's type (no SQL from the caller). SECURITY INVOKER: each call runs with the caller's
-- rights and auth.uid(), in its own sub-transaction (an error only for that key). Row functions answer the same JSON array
-- of rows PostgREST sends.

create or replace function public.rpc_bundle2(p_calls jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  c jsonb; k text; n text; a jsonb; v jsonb; f record; arg text; i int; args text; ty text;
  v_out jsonb := '{}'::jsonb;
  ok text[] := array['game_poll', 'gang_poll', 'skal_poll', 'film_poll', 'ceremony_poll', 'walk_poll', 'my_invites',
                     'helg_state', 'my_status', 'my_inbox', 'my_dms', 'pickup_poll', 'safety_state', 'duel_poll', 'knuff_inbox',
                     'my_rallies', 'bar_status', 'medevac_checks', 'group_etas', 'beer_reactions',
                     'crew_poll', 'near_poll', 'my_meriter', 'avatars_for', 'ikvall_status', 'home_status', 'friend_totals',
                     'ghost_points2', 'golden_horse'];
begin
  if jsonb_typeof(p_calls) <> 'array' or jsonb_array_length(p_calls) > 24 then raise exception 'invalid_calls'; end if;
  for c in select x from jsonb_array_elements(p_calls) x loop
    k := left(coalesce(c->>'k', c->>'n', ''), 200); n := c->>'n'; a := coalesce(c->'a', '{}'::jsonb);
    if k = '' or v_out ? k then continue; end if;
    begin
      if n is null or not (n = any(ok)) or jsonb_typeof(a) <> 'object' then raise exception 'not_bundled'; end if;
      select p.oid, p.proargnames, p.proargtypes, p.pronargs, p.proretset into f
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n;
      if not found then raise exception 'Could not find the function public.%', n; end if;
      args := '';
      for arg in select jsonb_object_keys(a) loop
        i := array_position(f.proargnames[1:f.pronargs], arg);
        if i is null then raise exception 'not_bundled'; end if;
        ty := format_type(f.proargtypes[i - 1], null);
        args := args || case when args = '' then '' else ', ' end ||
                case when ty in ('jsonb', 'json') then format('%I => (%L::jsonb -> %L)::%s', arg, a::text, arg, ty)
                     else format('%I => (%L::jsonb ->> %L)::%s', arg, a::text, arg, ty) end;
      end loop;
      if f.proretset then
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I(%s) x', n, args) into v;
      else
        execute format('select to_jsonb(public.%I(%s))', n, args) into v;
      end if;
      v_out := v_out || jsonb_build_object(k, jsonb_build_object('d', v));
    exception when others then
      v_out := v_out || jsonb_build_object(k, jsonb_build_object('e', jsonb_build_object('message', sqlerrm, 'code', sqlstate)));
    end;
  end loop;
  return v_out;
end; $$;
revoke all on function public.rpc_bundle2(jsonb) from public, anon;
grant execute on function public.rpc_bundle2(jsonb) to authenticated;
