-- public.olnu_spel_board(p_room uuid)
-- live md5(pg_get_functiondef) = 6898eee2dd6663a1d996c5e21e68397a
CREATE OR REPLACE FUNCTION public.olnu_spel_board(p_room uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name, 'score', p.score) order by p.score desc, p.ord), '[]'::jsonb)
    from public.spel_players p where p.room_id = p_room and (p.status = 'in' or p.score > 0);
$function$;
