-- public.olnu_spel_deck(p_n integer, p_not integer[])
-- live md5(pg_get_functiondef) = 9b9de76a0b82e5c84b610e245a778589
CREATE OR REPLACE FUNCTION public.olnu_spel_deck(p_n integer, p_not integer[] DEFAULT '{}'::integer[])
 RETURNS integer[]
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select coalesce(array(select x from generate_series(0, greatest(p_n, 1) - 1) x where not (x = any (coalesce(p_not, '{}'::int[])))
                        order by random()), '{}'::int[]);
$function$;
