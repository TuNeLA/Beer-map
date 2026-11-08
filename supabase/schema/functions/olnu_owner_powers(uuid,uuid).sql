-- public.olnu_owner_powers(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 3cc7fdfc9dafc0389b74ea13cf671a6a
CREATE OR REPLACE FUNCTION public.olnu_owner_powers(p_group uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null and public.olnu_chief_member(p_group, p_uid)
     and coalesce(public.olnu_owner_of(p_group), public.olnu_chief_of(p_group)) = p_uid;
$function$;
