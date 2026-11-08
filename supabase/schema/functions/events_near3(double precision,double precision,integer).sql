-- public.events_near3(p_lat double precision, p_lng double precision, p_days integer)
-- live md5(pg_get_functiondef) = 328b557dd21df8ad3d673109ad320370
CREATE OR REPLACE FUNCTION public.events_near3(p_lat double precision, p_lng double precision, p_days integer DEFAULT 31)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(31, coalesce(p_days, 31)));
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  return jsonb_build_object('v', 1, 'server_time', now(), 'days', v_days, 'dedupe', 1,
                            'events', public.olnu_ev_near_json(p_lat, p_lng, v_days, 400, v_uid));
end; $function$;
