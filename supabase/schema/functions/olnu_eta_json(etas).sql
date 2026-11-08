-- public.olnu_eta_json(e etas)
-- live md5(pg_get_functiondef) = 941a959f51ee0ff9ebf6991d3d2787de
CREATE OR REPLACE FUNCTION public.olnu_eta_json(e etas)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', e.id, 'bar_id', e.bar_id, 'bar_name', e.bar_name, 'lat', e.lat, 'lng', e.lng,
    'rally_id', e.rally_id, 'minutes', e.minutes, 'created_at', e.created_at, 'eta_at', e.eta_at,
    'expires_at', e.expires_at,
    'mins_left', greatest(0, ceil(extract(epoch from (e.eta_at - now())) / 60.0))::int,
    'arrived', e.arrived_at is not null, 'arrived_at', e.arrived_at,
    'active', public.olnu_eta_live(e));
$function$;
