-- public.olnu_squad_json(g squad_gatherings, p_viewer uuid)
-- live md5(pg_get_functiondef) = c936a2b43235cdc76cc5436d20683762
CREATE OR REPLACE FUNCTION public.olnu_squad_json(g squad_gatherings, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', g.id, 'group_id', g.group_id,
    'group_name', (select gr.name from public.groups gr where gr.id = g.group_id),
    'place', g.place_name, 'kind', g.place_kind, 'bar_id', g.bar_id, 'n', g.n,
    'names', coalesce((select jsonb_agg(gm.display_name order by array_position(g.members, gm.user_id))
                         from public.group_members gm where gm.group_id = g.group_id and gm.user_id = any(g.members)), '[]'::jsonb),
    'here', p_viewer = any(g.members), 'at', g.created_at, 'updated_at', g.updated_at);
$function$;
