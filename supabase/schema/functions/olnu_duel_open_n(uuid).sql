-- public.olnu_duel_open_n(p_group uuid)
-- live md5(pg_get_functiondef) = 10f900170fb3e99e66b0c574b377ca81
CREATE OR REPLACE FUNCTION public.olnu_duel_open_n(p_group uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.duels d
   where (d.group_a = p_group or d.group_b = p_group) and d.ends_at > now()
     and (d.status = 'active' or (d.status = 'pending' and d.answer_by > now()));
$function$;
