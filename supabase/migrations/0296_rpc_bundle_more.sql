-- 0296 — rpc_bundle (0295) takes more of the idle map polls: duel_poll, knuff_inbox (jsonb) and the row-returning
-- my_rallies, bar_status, medevac_checks, group_etas, beer_reactions (answer = the same JSON array of rows PostgREST sends).
-- create or replace of 0295's function only: the answers for the 0295 names stay the same. Nothing else changes.

create or replace function public.rpc_bundle(p_names text[])
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  n text;
  v jsonb;
  v_out jsonb := '{}'::jsonb;
  ok text[] := array['game_poll', 'gang_poll', 'skal_poll', 'film_poll', 'ceremony_poll', 'walk_poll', 'my_invites',
                     'helg_state', 'my_status', 'my_inbox', 'my_dms', 'pickup_poll', 'safety_state', 'duel_poll', 'knuff_inbox'];
  rows text[] := array['my_rallies', 'bar_status', 'medevac_checks', 'group_etas', 'beer_reactions'];
begin
  if p_names is null or cardinality(p_names) > 24 then raise exception 'invalid_names'; end if;
  foreach n in array p_names loop
    if n is null or v_out ? n then continue; end if;
    if not (n = any(ok) or n = any(rows)) then
      v_out := v_out || jsonb_build_object(n, jsonb_build_object('e', jsonb_build_object('message', 'not_bundled', 'code', 'not_bundled')));
      continue;
    end if;
    begin
      if n = 'safety_state' then
        v := to_jsonb(public.safety_state(false));
      elsif n = any(rows) then
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I() x', n) into v;
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
