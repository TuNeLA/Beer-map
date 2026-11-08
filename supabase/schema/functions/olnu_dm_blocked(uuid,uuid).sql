-- public.olnu_dm_blocked(p_a uuid, p_b uuid)
-- live md5(pg_get_functiondef) = 7e25b1a7c51c64364defa0c2e5a2b3e5
CREATE OR REPLACE FUNCTION public.olnu_dm_blocked(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.dm_blocks k
                  where k.active and ((k.blocker = p_a and k.blocked = p_b) or (k.blocker = p_b and k.blocked = p_a)))
      or public.olnu_ub_hidden(p_a, p_b);
$function$;
