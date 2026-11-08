-- public.start_agent(p_group_id uuid)
-- live md5(pg_get_functiondef) = 0f19249a221d6e8c749db46457804168
CREATE OR REPLACE FUNCTION public.start_agent(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_start_agent(v_uid, p_group_id, now()); end; $function$;
