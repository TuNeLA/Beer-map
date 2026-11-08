-- public.stop_beer()
-- live md5(pg_get_functiondef) = 69d62e47248a3e82af45a496fc98240f
CREATE OR REPLACE FUNCTION public.stop_beer()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  update public.beers set stopped = true
   where user_id = v_uid and expires_at > now();
end;
$function$;
