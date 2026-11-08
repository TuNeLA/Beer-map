-- public.set_sugen(p_status text)
-- live md5(pg_get_functiondef) = 072610d5f8e0aac9f350d1c476f46217
CREATE OR REPLACE FUNCTION public.set_sugen(p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_sugen(v_uid, p_status, now()); end; $function$;
