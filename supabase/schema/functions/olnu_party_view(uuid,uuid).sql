-- public.olnu_party_view(p_room uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 9468e7b8c8e1f64c9ed297814beb3710
CREATE OR REPLACE FUNCTION public.olnu_party_view(p_room uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.party_rooms; me public.party_players; h public.party_players;
  v_need uuid[]; v_done uuid[]; v_pub jsonb; v_priv jsonb := '{}'::jsonb; v_players jsonb; v_mine text; v_imps uuid[];
  v_away boolean; v_idx int;
begin
  select * into r from public.party_rooms where id = p_room;
  select * into me from public.party_players where room_id = p_room and user_id = p_uid;
  select * into h from public.party_players where room_id = p_room and user_id = r.host;
  v_need := public.olnu_party_need(p_room);
  v_done := coalesce(array(select i.user_id from public.party_inputs i
                            where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk'), '{}'::uuid[]);
  v_away := h.user_id is null or h.status = 'left' or h.seen_at < now() - interval '45 seconds';
  select coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name, 'is_host', p.is_host, 'status', p.status,
           'in_game', p.in_game, 'score', p.score, 'wins', p.wins, 'is_me', p.user_id = p_uid,
           'done', p.user_id = any (v_done), 'need', p.user_id = any (v_need), 'on', p.seen_at > now() - interval '40 seconds')
           order by p.is_host desc, p.ord, p.joined_at), '[]'::jsonb)
    into v_players from public.party_players p where p.room_id = p_room and p.status <> 'left';

  v_pub := r.pub;
  if r.game = 'hatten' and r.phase = 'reveal' then
    v_pub := jsonb_set(v_pub, '{slips}', coalesce((select jsonb_agg(s.x order by s.i) from jsonb_array_elements(r.pub->'slips')
      with ordinality as s(x, i) where s.i <= r.step), '[]'::jsonb));
  end if;

  if r.pub ? 'rk' and r.pub->>'rk' is not null then
    select i.val into v_mine from public.party_inputs i
     where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk' and i.user_id = p_uid;
    v_priv := v_priv || jsonb_build_object('mine', v_mine);
  end if;
  if r.game = 'imposter' and me.in_game and r.phase not in ('lobby', 'end') then
    v_imps := coalesce(array(select x::uuid from jsonb_array_elements_text(r.sec->'imps') x), '{}'::uuid[]);
    if p_uid = any (v_imps) then
      v_priv := v_priv || jsonb_build_object('imp', true, 'imp_n', cardinality(v_imps),
        'hint', case when coalesce((r.pub->>'hint')::boolean, true) then r.sec->>'hint' else null end);
    else
      v_priv := v_priv || jsonb_build_object('imp', false, 'word', r.sec->>'word');
    end if;
  elsif r.game = 'vagen' and r.phase in ('clue', 'guess') and me.k = r.pub->>'psy_k' then
    v_priv := v_priv || jsonb_build_object('target', (r.sec->>'target')::int);
  elsif r.game = 'hatten' and r.phase = 'vote' then
    select (a.i - 1)::int into v_idx from jsonb_array_elements_text(r.sec->'auth') with ordinality as a(u, i) where a.u = p_uid::text limit 1;
    v_priv := v_priv || jsonb_build_object('my_slip', v_idx);
  end if;

  return jsonb_build_object('v', r.v, 'now', now(), 'id', r.id, 'code', r.code, 'game', r.game, 'phase', r.phase,
    'round', r.round, 'step', r.step, 'game_no', r.game_no, 'opts', r.opts, 'expires_at', r.expires_at,
    'group_id', r.group_id, 'closed', r.closed or r.expires_at <= now(),
    'host_k', h.k, 'host_name', h.name, 'host_away', v_away,
    'me', jsonb_build_object('k', me.k, 'name', me.name, 'is_host', me.is_host, 'status', me.status, 'in_game', me.in_game,
      'score', me.score, 'wins', me.wins, 'can_host', me.is_host or (v_away and me.status in ('in', 'out', 'wait', 'tv'))),
    'players', v_players, 'pub', v_pub, 'priv', v_priv);
end; $function$;
