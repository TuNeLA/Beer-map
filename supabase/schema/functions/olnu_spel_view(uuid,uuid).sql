-- public.olnu_spel_view(p_room uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 1a16ae052e4f6c2be402f644d3c9c3c4
CREATE OR REPLACE FUNCTION public.olnu_spel_view(p_room uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.spel_rooms; me public.spel_players; v_done uuid[]; v_players jsonb; v_mine jsonb; v_judge uuid; v_jon boolean;
  v_force boolean := false; v_c text;
begin
  select * into r from public.spel_rooms where id = p_room;
  select * into me from public.spel_players where room_id = p_room and user_id = p_uid;
  v_judge := nullif(r.sec->>'judge', '')::uuid;
  v_done := coalesce(array(select i.user_id from public.spel_inputs i where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round), '{}'::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name, 'score', p.score, 'is_me', p.user_id = p_uid,
           'done', p.user_id = any (v_done), 'judge', r.game = 'kort' and p.user_id = v_judge,
           'on', p.seen_at > now() - interval '75 seconds') order by p.ord), '[]'::jsonb)
    into v_players from public.spel_players p where p.room_id = p_room and p.status = 'in';
  select i.val into v_mine from public.spel_inputs i where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round and i.user_id = p_uid;
  select p.status = 'in' and p.seen_at > now() - interval '40 seconds' into v_jon from public.spel_players p where p.room_id = p_room and p.user_id = v_judge;
  if r.phase in ('pick', 'vote') then
    v_force := (p_uid = v_judge or p_uid = r.created_by) and cardinality(v_done) > 0
            or r.updated_at < now() - interval '75 seconds';
  elsif r.phase = 'judge' then
    v_force := p_uid = v_judge or not coalesce(v_jon, false);
  end if;
  select k into v_c from public.spel_players where room_id = p_room and user_id = r.created_by;
  return jsonb_build_object('v', r.v, 'now', now(), 'id', r.id, 'group_id', r.group_id, 'game', r.game, 'phase', r.phase,
    'round', r.round, 'goal', r.goal, 'game_no', r.game_no, 'pub', r.pub, 'closed', r.closed or r.expires_at <= now(),
    'expires_at', r.expires_at, 'creator_k', v_c, 'judge_on', coalesce(v_jon, false),
    'me', jsonb_build_object('k', me.k, 'name', me.name, 'score', me.score, 'status', me.status,
      'hand', case when r.game = 'kort' and r.phase <> 'lobby' then to_jsonb(me.hand) else '[]'::jsonb end,
      'judge', r.game = 'kort' and p_uid = v_judge, 'mine', v_mine, 'can_force', v_force),
    'players', v_players);
end; $function$;
