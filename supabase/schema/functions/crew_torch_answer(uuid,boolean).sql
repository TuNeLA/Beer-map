-- public.crew_torch_answer(p_group_id uuid, p_accept boolean)
-- live md5(pg_get_functiondef) = 6a19cd881270a282aff27e27c97be877
CREATE OR REPLACE FUNCTION public.crew_torch_answer(p_group_id uuid, p_accept boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t public.crew_torches; g record;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into t from public.crew_torches x where x.pending = p_group_id and x.night = public.olnu_night_of(now())
   order by x.pending_at desc limit 1;
  if not found then raise exception 'no_offer'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_torch:' || t.id::text, 0));
  select * into t from public.crew_torches x where x.id = t.id;
  if t.pending is distinct from p_group_id or t.pending_until <= now() then
    perform public.olnu_crew_torch_tick(t.id);
    raise exception 'no_offer';
  end if;
  if not coalesce(p_accept, true) then
    perform public.olnu_crew_torch_move(t.id, p_group_id);
    return jsonb_build_object('ok', true, 'holder', false);
  end if;
  select * into g from public.olnu_crew_town_groups(t.town, t.c_lat, t.c_lng) x where x.group_id = p_group_id;
  insert into public.crew_torch_hops (torch_id, from_group, to_group, how, by_user, bar_id, bar_name, lat, lng)
  values (t.id, t.holder, p_group_id, 'pass', v_uid, g.bar_id, g.bar_name, g.bar_lat, g.bar_lng);
  update public.crew_torches x set holder = p_group_id, pending = null, pending_from = null, pending_at = null,
         pending_until = null, passes = x.passes + 1, updated_at = now() where x.id = t.id;
  return jsonb_build_object('ok', true, 'holder', true);
end; $function$;
