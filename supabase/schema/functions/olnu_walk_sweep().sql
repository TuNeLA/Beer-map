-- public.olnu_walk_sweep()
-- live md5(pg_get_functiondef) = c0c7856229eb256c7cff402253b84174
CREATE OR REPLACE FUNCTION public.olnu_walk_sweep()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.walks set ended_at = ends_at, end_reason = 'timeout', lat = null, lng = null, acc = null
   where ended_at is null and ends_at < now();
$function$;
