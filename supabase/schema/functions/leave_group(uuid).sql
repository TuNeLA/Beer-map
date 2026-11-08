-- public.leave_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = a0998544d308e5865ef1549ea5c164ad
CREATE OR REPLACE FUNCTION public.leave_group(p_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  delete from public.group_members where group_id = p_group_id and user_id = v_uid;
  delete from public.groups g
   where g.id = p_group_id
     and not exists (select 1 from public.group_members m where m.group_id = p_group_id);
end;
$function$;
