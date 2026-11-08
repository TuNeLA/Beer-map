-- public.my_status()
-- live md5(pg_get_functiondef) = a83ce509f3461baf404bd6397bd2bdb1
CREATE OR REPLACE FUNCTION public.my_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return coalesce((
    select jsonb_agg(public.olnu_status_json(r, v_uid) order by r.created_at desc)
      from public.status_reqs r
      join public.group_members m on m.group_id = r.group_id and m.user_id = v_uid
     where r.created_at > now() - interval '70 minutes'), '[]'::jsonb);
end; $function$;
