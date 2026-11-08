-- public.status_report(p_req_id bigint)
-- live md5(pg_get_functiondef) = 63fe255391979a513858e600b85cfd38
CREATE OR REPLACE FUNCTION public.status_report(p_req_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  r public.status_reqs;
begin
  select * into r from public.status_reqs x where x.id = p_req_id and x.created_at > now() - interval '12 hours';
  if not found then raise exception 'status_not_found'; end if;
  if not public.olnu_chief_member(r.group_id, v_uid) then raise exception 'not_member'; end if;
  return public.olnu_status_json(r, v_uid);
end; $function$;
