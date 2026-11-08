-- public.olnu_rnd_uid_of(p_group uuid, p_k text)
-- live md5(pg_get_functiondef) = de23700958cd2ae92693cc5c697daf6e
CREATE OR REPLACE FUNCTION public.olnu_rnd_uid_of(p_group uuid, p_k text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select x.user_id from (
    select m.user_id from public.group_members m where m.group_id = p_group
    union
    select e.user_id from public.olnu_evg_people(p_group) e
  ) x where public.olnu_rnd_k(p_group, x.user_id) = p_k limit 1;
$function$;
