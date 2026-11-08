-- public.olnu_snap_sweep()
-- live md5(pg_get_functiondef) = fc75a16ee35cc03b1ea637be192dfc41
CREATE OR REPLACE FUNCTION public.olnu_snap_sweep()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.snap_photos sp set bytes = null where sp.expires_at < now() and sp.bytes is not null;
$function$;
