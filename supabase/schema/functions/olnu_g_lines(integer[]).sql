-- public.olnu_g_lines(p_t integer[])
-- live md5(pg_get_functiondef) = 058ff7a8c5802ec81984535bf03fe58f
CREATE OR REPLACE FUNCTION public.olnu_g_lines(p_t integer[])
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::int from (values (array[0,1,2]), (array[3,4,5]), (array[6,7,8]), (array[0,3,6]),
                                    (array[1,4,7]), (array[2,5,8]), (array[0,4,8]), (array[2,4,6])) l(a)
   where l.a <@ coalesce(p_t, '{}'::int[]);
$function$;
