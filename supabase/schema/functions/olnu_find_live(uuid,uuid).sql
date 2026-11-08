-- public.olnu_find_live(p_x uuid, p_y uuid)
-- live md5(pg_get_functiondef) = 7fab971a30fbc846788b490adff46101
CREATE OR REPLACE FUNCTION public.olnu_find_live(p_x uuid, p_y uuid)
 RETURNS find_reqs
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.* from public.find_reqs r
   where ((r.from_uid = p_x and r.to_uid = p_y) or (r.from_uid = p_y and r.to_uid = p_x))
     and ((r.status = 'pending' and r.answer_by > now()) or (r.status in ('accepted', 'auto') and r.until > now()))
   order by r.created_at desc limit 1;
$function$;
