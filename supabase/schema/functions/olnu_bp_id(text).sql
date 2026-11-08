-- public.olnu_bp_id(p_key text)
-- live md5(pg_get_functiondef) = 30a85d38d141891410bf2fe506221a02
CREATE OR REPLACE FUNCTION public.olnu_bp_id(p_key text)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when coalesce(p_key, '') ~ '^bp[0-9]{1,18}$' then substr(p_key, 3)::bigint end;
$function$;
