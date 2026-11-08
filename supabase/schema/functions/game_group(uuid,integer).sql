-- public.game_group(p_group_id uuid, p_bingo_n integer)
-- live md5(pg_get_functiondef) = bb89965ee3ae76e09565fbc46c63e291
CREATE OR REPLACE FUNCTION public.game_group(p_group_id uuid, p_bingo_n integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return public.olnu_g_group(v_uid, p_group_id, now(), true, p_bingo_n)
      || jsonb_build_object('id', p_group_id, 'name', (select g.name from public.groups g where g.id = p_group_id));
end;
$function$;
