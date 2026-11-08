-- public.olnu_pickup_sweep()
-- live md5(pg_get_functiondef) = 85c8d24c5d9709298ddf15a5569ed19f
CREATE OR REPLACE FUNCTION public.olnu_pickup_sweep()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.pickup_reqs set ended_at = ends_at, end_reason = 'timeout', lat = null, lng = null, acc = null
   where ended_at is null and ends_at < now();
$function$;
