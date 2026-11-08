-- public.crew_poll(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = ec22fe89d69bd591acdc4d4ec609f2f7
CREATE OR REPLACE FUNCTION public.crew_poll(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_groups jsonb; v_torch jsonb := null; v_offers jsonb;
  tw record; v_tid bigint; r record;
begin
  select coalesce(jsonb_agg(public.olnu_crew_group_json(m.group_id, v_uid, false) order by m.joined_at), '[]'::jsonb)
    into v_groups
    from (select gm.group_id, gm.joined_at from public.group_members gm where gm.user_id = v_uid
           order by gm.joined_at limit 10) m;
  for r in select t.id from public.crew_torches t
            where t.night = v_night and t.pending is not null
              and t.pending in (select gm.group_id from public.group_members gm where gm.user_id = v_uid) loop
    perform public.olnu_crew_torch_tick(r.id);
  end loop;
  select * into tw from public.olnu_crew_my_town(v_uid, p_lat, p_lng);
  if tw.key is not null then
    select t.id into v_tid from public.crew_torches t where t.town = tw.key and t.night = v_night;
    if v_tid is not null then
      perform public.olnu_crew_torch_tick(v_tid);
      v_torch := public.olnu_crew_torch_json(v_tid, v_uid, false);
    else
      v_torch := jsonb_build_object('id', null, 'town', tw.name, 'lit', false);
    end if;
  end if;
  select coalesce(jsonb_agg(public.olnu_crew_torch_json(t.id, v_uid, false)), '[]'::jsonb) into v_offers
    from public.crew_torches t
   where t.night = v_night and t.pending is not null and t.pending_until > now()
     and t.pending in (select gm.group_id from public.group_members gm where gm.user_id = v_uid);
  return jsonb_build_object('v', 1, 'server_time', now(), 'night', v_night,
    'me', jsonb_build_object('bye_at', (select y.at from public.crew_byes y where y.user_id = v_uid and y.night = v_night and y.cleared_at is null)),
    'groups', v_groups, 'torch', v_torch, 'offers', v_offers);
end; $function$;
