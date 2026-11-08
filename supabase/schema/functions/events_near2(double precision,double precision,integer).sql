-- public.events_near2(p_lat double precision, p_lng double precision, p_days integer)
-- live md5(pg_get_functiondef) = 264361c0eb1561967b0a2b66bb46d6e5
CREATE OR REPLACE FUNCTION public.events_near2(p_lat double precision, p_lng double precision, p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(14, coalesce(p_days, 7)));
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  return jsonb_build_object('v', 1, 'server_time', now(), 'dedupe', 1, 'events', public.olnu_ev_near_json(p_lat, p_lng, v_days, 150, v_uid));
end; $function$;
