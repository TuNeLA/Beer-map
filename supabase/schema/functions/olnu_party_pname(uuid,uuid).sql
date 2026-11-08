-- public.olnu_party_pname(p_room uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = acd3d35af13519f7dad640c33067c70c
CREATE OR REPLACE FUNCTION public.olnu_party_pname(p_room uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.name from public.party_players p where p.room_id = p_room and p.user_id = p_uid;
$function$;
