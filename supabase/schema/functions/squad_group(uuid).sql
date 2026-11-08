-- public.squad_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = 7f1b004e75fa8608b58c1979ffdbd6f4
CREATE OR REPLACE FUNCTION public.squad_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_last jsonb;
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select coalesce(jsonb_agg(public.olnu_squad_json(x, v_uid) order by x.created_at desc), '[]'::jsonb) into v_last
    from (select * from public.squad_gatherings y where y.group_id = p_group_id order by y.created_at desc limit 10) x;
  return jsonb_build_object('nights', public.olnu_squad_nights(p_group_id),
    'total', (select count(*) from public.squad_gatherings x where x.group_id = p_group_id),
    'best_n', (select coalesce(max(x.n), 0) from public.squad_gatherings x where x.group_id = p_group_id),
    'last', v_last);
end; $function$;
