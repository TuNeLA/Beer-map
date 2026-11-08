-- public.olnu_rnd_swish_of(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = ccb62b558f655e2d6e71d277e2d419e7
CREATE OR REPLACE FUNCTION public.olnu_rnd_swish_of(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select s.number from public.rnd_swish s where s.user_id = p_uid and s.number is not null),
                  (select g.number from public.gang_swish g where g.group_id = p_group and g.user_id = p_uid and g.number is not null));
$function$;
