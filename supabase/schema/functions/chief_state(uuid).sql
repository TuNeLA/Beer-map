-- public.chief_state(p_group_id uuid)
-- live md5(pg_get_functiondef) = 1a5787b689399b57c61fc3e54ed29813
CREATE OR REPLACE FUNCTION public.chief_state(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return public.olnu_chief_json(p_group_id, v_uid);
end; $function$;
