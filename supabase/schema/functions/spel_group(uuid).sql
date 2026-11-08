-- public.spel_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = f7716c806b16cbc63a4c54ea70a4aa27
CREATE OR REPLACE FUNCTION public.spel_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); r public.spel_rooms; v_n int; v_names jsonb; v_in boolean;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid)
     and not public.olnu_evg_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into r from public.spel_rooms where group_id = p_group_id and not closed and expires_at > now() order by created_at desc limit 1;
  if r.id is null then return jsonb_build_object('room', null); end if;
  select count(*)::int, coalesce(jsonb_agg(p.name order by p.seen_at desc), '[]'::jsonb) into v_n, v_names
    from public.spel_players p where p.room_id = r.id and p.status = 'in' and p.seen_at > now() - interval '75 seconds';
  select exists (select 1 from public.spel_players p where p.room_id = r.id and p.user_id = v_uid and p.status = 'in') into v_in;
  if v_n = 0 then return jsonb_build_object('room', null); end if;
  return jsonb_build_object('room', jsonb_build_object('id', r.id, 'game', r.game, 'phase', r.phase, 'round', r.round, 'n', v_n,
    'names', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select jsonb_array_elements(v_names) x limit 4) s), 'is_in', v_in));
end; $function$;
