-- public.olnu_party_uid(p_room uuid, p_k text)
-- live md5(pg_get_functiondef) = 6e83be63442561e6a31596165290c3d7
CREATE OR REPLACE FUNCTION public.olnu_party_uid(p_room uuid, p_k text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.user_id from public.party_players p where p.room_id = p_room and p.k = p_k and p.status <> 'left';
$function$;
