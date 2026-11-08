-- public.olnu_party_people(p_room uuid, p_ids uuid[])
-- live md5(pg_get_functiondef) = c070b3a2c295e83700d6b663469a65c6
CREATE OR REPLACE FUNCTION public.olnu_party_people(p_room uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name) order by x.i), '[]'::jsonb)
    from unnest(p_ids) with ordinality as x(id, i) join public.party_players p on p.room_id = p_room and p.user_id = x.id;
$function$;
