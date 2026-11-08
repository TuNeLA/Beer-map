-- public.olnu_gone_count(p_bar_id text)
-- live md5(pg_get_functiondef) = bb990129fbc5b67e62010f0a94353704
CREATE OR REPLACE FUNCTION public.olnu_gone_count(p_bar_id text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct r.user_id)::int from public.bar_gone_reports r
   where r.bar_id = p_bar_id and r.withdrawn_at is null
     and r.created_at > coalesce((select g.status_at from public.bar_gone g where g.bar_id = p_bar_id and g.status = 'undone'), '-infinity'::timestamptz);
$function$;
