-- public.evg_lek(p_group_id uuid)
-- live md5(pg_get_functiondef) = cf0a8e34f9c0de718262d6926e870296
CREATE OR REPLACE FUNCTION public.evg_lek(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_evg_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return jsonb_build_object('night', v_night,
    'people', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group_id, e.user_id), 'name', e.name,
                 'is_me', e.user_id = v_uid, 'status', s.status, 'at', s.updated_at,
                 'out', public.olnu_g_live(e.user_id, v_night, now())) order by s.updated_at desc nulls last, e.ord)
               from public.olnu_evg_people(p_group_id) e
               left join public.game_sugen s on s.user_id = e.user_id and s.night = v_night and s.status <> 'none'), '[]'::jsonb),
    'ticks', coalesce((select jsonb_agg(jsonb_build_object('idx', t.idx, 'name', coalesce(e.name, '?'), 'is_me', t.user_id = v_uid) order by t.idx)
               from public.game_bingo_ticks t left join public.olnu_evg_people(p_group_id) e on e.user_id = t.user_id
              where t.group_id = p_group_id and t.night = v_night and t.ticked), '[]'::jsonb));
end; $function$;
