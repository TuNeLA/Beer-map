-- public.olnu_area_supersede(p_bar_id text, p_keep bigint)
-- live md5(pg_get_functiondef) = 750ffbbf9bc19d2290ff80b6f7f2115a
CREATE OR REPLACE FUNCTION public.olnu_area_supersede(p_bar_id text, p_keep bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.bar_areas a set superseded_at = now()
   where a.bar_id = p_bar_id and a.status = 'ok' and a.superseded_at is null and a.id <> p_keep;
$function$;
