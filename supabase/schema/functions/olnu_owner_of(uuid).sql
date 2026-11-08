-- public.olnu_owner_of(p_group uuid)
-- live md5(pg_get_functiondef) = eee436de7f3f6a2cad41d710466c9df2
CREATE OR REPLACE FUNCTION public.olnu_owner_of(p_group uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.created_by from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = g.created_by
   where g.id = p_group;
$function$;
