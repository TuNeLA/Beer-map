-- public.olnu_ub_hidden(p_a uuid, p_b uuid)
-- live md5(pg_get_functiondef) = 9f6fabbf92d0890484e51d5a2637e888
CREATE OR REPLACE FUNCTION public.olnu_ub_hidden(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.user_blocks k
     where k.active and ((k.blocker = p_a and k.blocked = p_b) or (k.blocker = p_b and k.blocked = p_a)));
$function$;
