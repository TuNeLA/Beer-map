-- public.olnu_dm_friends(p_a uuid, p_b uuid)
-- live md5(pg_get_functiondef) = ceef6f1e4cf1984a19d5d24848002f03
CREATE OR REPLACE FUNCTION public.olnu_dm_friends(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_a is not null and p_b is not null and p_a <> p_b and (
    exists (select 1 from public.friendships f
             where least(f.a, f.b) = least(p_a, p_b) and greatest(f.a, f.b) = greatest(p_a, p_b) and f.status = 'accepted')
    or exists (select 1 from public.group_members m1 join public.group_members m2 on m2.group_id = m1.group_id
                where m1.user_id = p_a and m2.user_id = p_b));
$function$;
