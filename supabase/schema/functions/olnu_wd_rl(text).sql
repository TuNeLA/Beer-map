-- public.olnu_wd_rl(p_key text)
-- live md5(pg_get_functiondef) = 8158def90219c9178a83bd9f20c0e775
CREATE OR REPLACE FUNCTION public.olnu_wd_rl(p_key text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select pg_advisory_xact_lock(hashtextextended('olnu_wd:' || p_key, 0));
$function$;
