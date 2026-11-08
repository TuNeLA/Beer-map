-- public.squad_poll()
-- live md5(pg_get_functiondef) = 40a9ad6b373e282ba947c34db02919c9
CREATE OR REPLACE FUNCTION public.squad_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  r record; v_out jsonb;
begin
  for r in select gm.group_id from public.group_members gm where gm.user_id = v_uid order by gm.joined_at limit 20 loop
    begin
      perform public.olnu_squad_detect(r.group_id);
    exception when others then null;
    end;
  end loop;
  select coalesce(jsonb_agg(public.olnu_squad_json(x, v_uid) || jsonb_build_object('nights', public.olnu_squad_nights(x.group_id))
                            order by x.created_at desc), '[]'::jsonb)
    into v_out
    from public.squad_gatherings x
   where x.created_at > now() - interval '3 hours'
     and x.group_id in (select gm.group_id from public.group_members gm where gm.user_id = v_uid);
  return jsonb_build_object('v', 1, 'server_time', now(), 'squads', v_out);
end; $function$;
