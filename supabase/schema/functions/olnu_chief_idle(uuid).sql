-- public.olnu_chief_idle(p_group uuid)
-- live md5(pg_get_functiondef) = c9bd129ddfb387d661abdccf3420cef7
CREATE OR REPLACE FUNCTION public.olnu_chief_idle(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.olnu_seen_at(p_group, public.olnu_chief_of(p_group)) < now() - interval '12 hours', true);
$function$;
