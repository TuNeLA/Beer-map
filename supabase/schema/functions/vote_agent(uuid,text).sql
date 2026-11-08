-- public.vote_agent(p_group_id uuid, p_member text)
-- live md5(pg_get_functiondef) = 7c076ef7d42e97baf3173f4580e49df1
CREATE OR REPLACE FUNCTION public.vote_agent(p_group_id uuid, p_member text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_vote(v_uid, p_group_id, p_member, now()); end; $function$;
