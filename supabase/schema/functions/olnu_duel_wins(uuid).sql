-- public.olnu_duel_wins(p_group uuid)
-- live md5(pg_get_functiondef) = cd7dec25f61e8379db066c07364c603c
CREATE OR REPLACE FUNCTION public.olnu_duel_wins(p_group uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.duels d
   where d.finished_at is not null and ((d.group_a = p_group and d.winner = 'a') or (d.group_b = p_group and d.winner = 'b'));
$function$;
