-- public.olnu_gang_town(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = acdee0b5f2b73d8aa9d4cc498c55ff48
CREATE OR REPLACE FUNCTION public.olnu_gang_town(p_lat double precision, p_lng double precision)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.olnu_town_of(p_lat, p_lng),
                  '~' || (round(p_lat::numeric * 2) / 2)::text || ':' || (round(p_lng::numeric))::text);
$function$;
