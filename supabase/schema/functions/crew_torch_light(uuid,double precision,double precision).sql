-- public.crew_torch_light(p_group_id uuid, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 8775a74d6897f7c1e3bf69c77c426732
CREATE OR REPLACE FUNCTION public.crew_torch_light(p_group_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  tw record; g record; v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into tw from public.olnu_crew_my_town(v_uid, p_lat, p_lng);
  if tw.key is null then raise exception 'no_town'; end if;
  select * into g from public.olnu_crew_town_groups(tw.key, tw.lat, tw.lng) x where x.group_id = p_group_id;
  if g.group_id is null then raise exception 'not_out'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_torch_town:' || tw.key || v_night::text, 0));
  select t.id into v_id from public.crew_torches t where t.town = tw.key and t.night = v_night;
  if v_id is not null then return jsonb_build_object('ok', false, 'already', true, 'id', v_id); end if;
  insert into public.crew_torches (town, town_name, c_lat, c_lng, night, holder)
  values (tw.key, tw.name, tw.lat, tw.lng, v_night, p_group_id) returning id into v_id;
  insert into public.crew_torch_hops (torch_id, from_group, to_group, how, by_user, bar_id, bar_name, lat, lng)
  values (v_id, null, p_group_id, 'light', v_uid, g.bar_id, g.bar_name, g.bar_lat, g.bar_lng);
  return jsonb_build_object('ok', true, 'already', false, 'id', v_id);
end; $function$;
