-- public.olnu_gang_rl(p_key text)
-- live md5(pg_get_functiondef) = 5f8c6599cd508a01356dcca19fd9f16e
CREATE OR REPLACE FUNCTION public.olnu_gang_rl(p_key text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select pg_advisory_xact_lock(hashtextextended('olnu_gang:' || p_key, 0));
$function$;
