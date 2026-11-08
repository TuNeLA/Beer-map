-- public.game_poll()
-- live md5(pg_get_functiondef) = 1e11968c79534f94e27f20e6d97f2183
CREATE OR REPLACE FUNCTION public.game_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := now();
  v_me  jsonb;
  v_gs  jsonb;
begin
  v_me := public.olnu_g_me(v_uid, v_now);
  select coalesce(jsonb_agg(public.olnu_g_group(v_uid, x.id, v_now, false, null)
                            || jsonb_build_object('id', x.id, 'name', x.name) order by x.created_at), '[]'::jsonb)
    into v_gs
    from (select g.id, g.name, g.created_at from public.groups g
            join public.group_members m on m.group_id = g.id and m.user_id = v_uid
           order by g.created_at limit 20) x;
  return jsonb_build_object('v', 1, 'server_time', v_now, 'night', public.olnu_night_of(v_now), 'me', v_me, 'groups', v_gs);
end;
$function$;
