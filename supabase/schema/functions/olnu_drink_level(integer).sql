-- public.olnu_drink_level(p_n integer)
-- live md5(pg_get_functiondef) = 7fd6458c86ac41e48be76a91c84172f6
CREATE OR REPLACE FUNCTION public.olnu_drink_level(p_n integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when coalesce(p_n, 0) >= 10 then 10 when coalesce(p_n, 0) >= 5 then 5
              when coalesce(p_n, 0) >= 1 then 1 else 0 end;
$function$;
