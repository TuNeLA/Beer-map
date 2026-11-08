-- public.olnu_find_key(r find_reqs, p_viewer uuid)
-- live md5(pg_get_functiondef) = 57255c2ff235fa4f025b7336d1bc4768
CREATE OR REPLACE FUNCTION public.olnu_find_key(r find_reqs, p_viewer uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when r.group_id is not null
              then 'g' || r.group_id::text || ':' || public.olnu_chief_k(r.group_id, case when r.from_uid = p_viewer then r.to_uid else r.from_uid end)
              else 'f' || r.friendship_id::text end;
$function$;
