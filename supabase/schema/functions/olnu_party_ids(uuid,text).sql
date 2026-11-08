-- public.olnu_party_ids(p_room uuid, p_status text)
-- live md5(pg_get_functiondef) = 57bb3ab6c4f1c3a325aea115fcf4af2e
CREATE OR REPLACE FUNCTION public.olnu_party_ids(p_room uuid, p_status text)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array(select p.user_id from public.party_players p
                         where p.room_id = p_room and p.status = p_status order by p.ord, p.joined_at), '{}'::uuid[]);
$function$;
