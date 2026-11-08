-- public.crew_torch(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 7b25e8dca4bf969a318194f88ed59a54
CREATE OR REPLACE FUNCTION public.crew_torch(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  tw record; v_tid bigint; v_my jsonb;
begin
  select * into tw from public.olnu_crew_my_town(v_uid, p_lat, p_lng);
  if tw.key is null then return jsonb_build_object('town', null, 'lit', false, 'no_town', true, 'my_groups', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', g.group_id, 'name', (select x.name from public.groups x where x.id = g.group_id), 'n', g.n)), '[]'::jsonb)
    into v_my from public.olnu_crew_town_groups(tw.key, tw.lat, tw.lng) g
   where public.olnu_crew_member(g.group_id, v_uid);
  select t.id into v_tid from public.crew_torches t where t.town = tw.key and t.night = v_night;
  if v_tid is null then
    return jsonb_build_object('town', tw.name, 'lit', false, 'my_groups', v_my);
  end if;
  perform public.olnu_crew_torch_tick(v_tid);
  return public.olnu_crew_torch_json(v_tid, v_uid, true) || jsonb_build_object('lit', true, 'my_groups', v_my);
end; $function$;
