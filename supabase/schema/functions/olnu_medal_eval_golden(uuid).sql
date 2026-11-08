-- public.olnu_medal_eval_golden(p_uid uuid)
-- live md5(pg_get_functiondef) = ad625a03f84d83e248fd0dbc122e079d
CREATE OR REPLACE FUNCTION public.olnu_medal_eval_golden(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'guldhast'::text, count(*)::int from public.golden_horses h where h.claimed_by = p_uid having count(*) > 0;
$function$;
