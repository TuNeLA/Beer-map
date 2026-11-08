-- public.crew_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = 8a33f123dae463ebcedb0092c4f69c6d
CREATE OR REPLACE FUNCTION public.crew_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return public.olnu_crew_group_json(p_group_id, v_uid, true) || jsonb_build_object('server_time', now());
end; $function$;
