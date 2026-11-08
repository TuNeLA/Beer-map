-- public.olnu_gw_mates(p_a uuid, p_b uuid)
-- live md5(pg_get_functiondef) = a2669e5d6922228d9d0e2cb12f160d8d
CREATE OR REPLACE FUNCTION public.olnu_gw_mates(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_a is not null and p_b is not null and p_a <> p_b and (
    public.olnu_are_friends(p_a, p_b)
    or exists (select 1 from public.group_members x join public.group_members y on y.group_id = x.group_id
                where x.user_id = p_a and y.user_id = p_b and not public.olnu_is_temp_group(x.group_id)));
$function$;
