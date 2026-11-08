-- public.olnu_duel_pair(p_g1 uuid, p_g2 uuid)
-- live md5(pg_get_functiondef) = a45b0cb9e8da44c205fe46258c413dc0
CREATE OR REPLACE FUNCTION public.olnu_duel_pair(p_g1 uuid, p_g2 uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.id from public.duels d
   where ((d.group_a = p_g1 and d.group_b = p_g2) or (d.group_a = p_g2 and d.group_b = p_g1))
     and d.ends_at > now() and (d.status = 'active' or (d.status = 'pending' and d.answer_by > now()))
   order by d.id desc limit 1;
$function$;
