-- public.set_display_name(p_display_name text)
-- live md5(pg_get_functiondef) = b922a39275dac7461807fe943f71c3b9
CREATE OR REPLACE FUNCTION public.set_display_name(p_display_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := public.olnu_uid();
  v_display text := public.olnu_clean_display_name(p_display_name);
begin
  update public.group_members set display_name = v_display where user_id = v_uid;
end;
$function$;
