-- public.import_event_towns()
-- live md5(pg_get_functiondef) = 6ccb92cb6f31586dc44a5858fa668484
CREATE OR REPLACE FUNCTION public.import_event_towns()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'lat', t.lat, 'lng', t.lng) order by t.name), '[]'::jsonb) from public.olnu_towns t;
$function$;
