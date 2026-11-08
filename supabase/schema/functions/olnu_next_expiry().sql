-- public.olnu_next_expiry()
-- live md5(pg_get_functiondef) = d300d7c9e07d05b3d1256790d276028d
CREATE OR REPLACE FUNCTION public.olnu_next_expiry()
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_local  timestamp := now() at time zone 'Europe/Stockholm';
  v_target timestamp := date_trunc('day', v_local) + interval '5 hours';
begin
  if v_local >= v_target then
    v_target := v_target + interval '1 day';
  end if;
  return v_target at time zone 'Europe/Stockholm';
end;
$function$;
