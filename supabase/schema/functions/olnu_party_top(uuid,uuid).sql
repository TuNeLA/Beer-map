-- public.olnu_party_top(p_room uuid, p_not uuid)
-- live md5(pg_get_functiondef) = ea7884bc0e1e54307fddffc8d4f63366
CREATE OR REPLACE FUNCTION public.olnu_party_top(p_room uuid, p_not uuid DEFAULT NULL::uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (select p.user_id, p.score from public.party_players p
              where p.room_id = p_room and p.in_game and p.status <> 'left' and p.user_id is distinct from p_not)
  select coalesce(array(select s.user_id from s where s.score > 0 and s.score = (select max(score) from s)), '{}'::uuid[]);
$function$;
