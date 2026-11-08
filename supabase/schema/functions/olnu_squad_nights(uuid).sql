-- public.olnu_squad_nights(p_group uuid)
-- live md5(pg_get_functiondef) = 58d55ab9dd21206aeb0261ff45e455bb
CREATE OR REPLACE FUNCTION public.olnu_squad_nights(p_group uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct x.night)::int from public.squad_gatherings x where x.group_id = p_group;
$function$;
