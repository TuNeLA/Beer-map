-- public.tick_bingo(p_group_id uuid, p_idx integer, p_on boolean)
-- live md5(pg_get_functiondef) = 5f347554cc97537002c6bb10338da6d0
CREATE OR REPLACE FUNCTION public.tick_bingo(p_group_id uuid, p_idx integer, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_tick(v_uid, p_group_id, p_idx, p_on, now()); end; $function$;
