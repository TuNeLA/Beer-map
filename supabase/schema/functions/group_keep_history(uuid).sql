-- public.group_keep_history(p_group_id uuid)
-- live md5(pg_get_functiondef) = 704512ee91db6ce990d7ccaa0a303f67
CREATE OR REPLACE FUNCTION public.group_keep_history(p_group_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_group_keeps(p_group_id);
end; $function$;
