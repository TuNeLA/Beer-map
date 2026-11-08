-- public.create_crawl(p_group_id uuid, p_stops jsonb)
-- live md5(pg_get_functiondef) = 1bfdb33d2c8db6188b589c4a93e34851
CREATE OR REPLACE FUNCTION public.create_crawl(p_group_id uuid, p_stops jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_crawl(v_uid, p_group_id, p_stops, now()); end; $function$;
