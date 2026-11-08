-- public.member_medals(p_group_id uuid)
-- live md5(pg_get_functiondef) = a5a1573eedffdcdaad46afb6e83d5070
CREATE OR REPLACE FUNCTION public.member_medals(p_group_id uuid)
 RETURNS TABLE(name text, is_me boolean, medal text, earned_at timestamp with time zone, count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select gm.display_name, (gm.user_id = v_uid), um.medal, um.earned_at, um.count
    from public.group_members gm
    join public.user_medals um on um.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by gm.display_name, um.earned_at, um.medal
   limit 5000;
end;
$function$;
