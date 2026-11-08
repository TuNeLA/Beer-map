-- public.olnu_g_group(p_uid uuid, p_group uuid, p_now timestamp with time zone, p_full boolean, p_bingo_n integer)
-- live md5(pg_get_functiondef) = f8e6ae2c9af4e613fb0c5ae86b72b5f6
CREATE OR REPLACE FUNCTION public.olnu_g_group(p_uid uuid, p_group uuid, p_now timestamp with time zone, p_full boolean DEFAULT false, p_bingo_n integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_prev  timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_out   jsonb := '{}'::jsonb;
  v_j     jsonb;
  v_c     record;
  v_stops jsonb;
  v_dn    int;
  v_card  record;
  v_t     int[];
  v_ticks jsonb;
  v_a     record;
  v_n     int;
  v_bn    int := greatest(9, least(400, coalesce(p_bingo_n, 40)));
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = p_uid, 'status', s.status, 'at', s.updated_at,
           'out', public.olnu_g_live(m.user_id, v_night, p_now)) order by s.updated_at desc), '[]'::jsonb)
    into v_j
    from public.group_members m
    join public.game_sugen s on s.user_id = m.user_id and s.night = v_night and s.status <> 'none'
   where m.group_id = p_group;
  v_out := v_out || jsonb_build_object('sugen', v_j);

  select * into v_c from public.game_crawls c
   where c.group_id = p_group and c.night = v_night and not c.closed order by c.id desc limit 1;
  if found then
    select jsonb_agg(jsonb_build_object('i', s.ord - 1, 'id', s.v->>'id', 'name', s.v->>'name',
             'lat', (s.v->>'lat')::float8, 'lng', (s.v->>'lng')::float8, 'done', w.names is not null,
             'who', case when p_full then w.names end) order by s.ord),
           count(*) filter (where w.names is not null)
      into v_stops, v_dn
      from jsonb_array_elements(v_c.stops) with ordinality s(v, ord)
      left join lateral (
        select jsonb_agg(m.display_name order by m.display_name) as names
          from public.group_members m
          join public.medal_checkins mc on mc.user_id = m.user_id and mc.night = v_night and mc.bar_id = s.v->>'id'
         where m.group_id = p_group) w on true;
    if v_dn >= v_c.n and v_c.done_at is null then
      update public.game_crawls c set done_at = p_now where c.id = v_c.id and c.done_at is null;
      v_c.done_at := p_now;
    end if;
    v_out := v_out || jsonb_build_object('crawl', jsonb_build_object(
      'id', v_c.id, 'n', v_c.n, 'done_n', v_dn, 'done', v_c.done_at is not null, 'done_at', v_c.done_at,
      'is_mine', v_c.user_id = p_uid, 'created_at', v_c.created_at,
      'by', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_c.user_id),
      'stops', v_stops));
  else
    v_out := v_out || jsonb_build_object('crawl', null);
  end if;

  select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  if not found and p_full then
    insert into public.game_bingo_cards (group_id, night, card, n)
    select p_group, v_night, array_agg(z.x), v_bn
      from (select x from generate_series(0, v_bn - 1) x order by random() limit 9) z
    on conflict do nothing;
    select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  end if;
  if v_card.group_id is not null then
    select array_agg(t.idx::int order by t.idx),
           jsonb_agg(jsonb_build_object('idx', t.idx, 'name', m.display_name, 'is_me', t.user_id = p_uid) order by t.idx)
      into v_t, v_ticks
      from public.game_bingo_ticks t
      left join public.group_members m on m.group_id = p_group and m.user_id = t.user_id
     where t.group_id = p_group and t.night = v_night and t.ticked;
    v_out := v_out || jsonb_build_object('bingo', jsonb_build_object(
      'card', case when p_full then to_jsonb(v_card.card) end, 'n', v_card.n,
      'ticks', case when p_full then coalesce(v_ticks, '[]'::jsonb) else to_jsonb(coalesce(array_length(v_t, 1), 0)) end,
      'lines', public.olnu_g_lines(v_t), 'bingo_at', v_card.bingo_at));
  else
    v_out := v_out || jsonb_build_object('bingo', null);
  end if;

  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_night;
  if found then
    v_out := v_out || jsonb_build_object('agent', jsonb_build_object(
      'active', true, 'is_me', v_a.agent = p_uid, 'mission', case when v_a.agent = p_uid then v_a.mission end,
      'by', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_a.started_by)));
  else
    v_out := v_out || jsonb_build_object('agent', null);
  end if;

  begin
    perform public.olnu_g_reveal(p_group, v_prev, p_now);
  exception when others then
    null;
  end;
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_prev;
  if found then
    select count(*) into v_n from public.game_agent_votes v where v.group_id = p_group and v.night = v_prev;
    v_j := jsonb_build_object(
      'revealed', v_a.revealed_at is not null, 'voting', v_a.revealed_at is null,
      'reveal_at', ((v_prev at time zone 'Europe/Stockholm') + interval '7 hours') at time zone 'Europe/Stockholm',
      'votes', v_n,
      'needed', (select count(*) from public.group_members m where m.group_id = p_group and m.user_id <> v_a.agent),
      'is_agent', v_a.agent = p_uid,
      'my_vote', (select public.olnu_g_key(p_group, v.suspect) from public.game_agent_votes v
                   where v.group_id = p_group and v.night = v_prev and v.voter = p_uid),
      'mission', case when v_a.revealed_at is not null or v_a.agent = p_uid then v_a.mission end);
    if v_a.revealed_at is not null then
      v_j := v_j || jsonb_build_object(
        'agent_name', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_a.agent),
        'agent_k', public.olnu_g_key(p_group, v_a.agent), 'correct', coalesce(v_a.correct, 0),
        'correct_names', (select coalesce(jsonb_agg(m.display_name order by v.created_at), '[]'::jsonb)
                            from public.game_agent_votes v
                            join public.group_members m on m.group_id = p_group and m.user_id = v.voter
                           where v.group_id = p_group and v.night = v_prev and v.suspect = v_a.agent),
        'i_was_right', exists (select 1 from public.game_agent_votes v where v.group_id = p_group and v.night = v_prev
                                 and v.voter = p_uid and v.suspect = v_a.agent));
    end if;
    v_out := v_out || jsonb_build_object('agent_prev', v_j);
  else
    v_out := v_out || jsonb_build_object('agent_prev', null);
  end if;

  begin
    perform public.olnu_g_oracle(p_group, v_prev, p_now);
  exception when others then
    null;
  end;
  select o.*, m.display_name into v_a from public.game_oracles o
    left join public.group_members m on m.group_id = p_group and m.user_id = o.user_id
   where o.group_id = p_group and o.night = v_prev;
  if found then
    v_out := v_out || jsonb_build_object('oracle', jsonb_build_object(
      'name', v_a.display_name, 'is_me', v_a.user_id = p_uid, 'guess', v_a.guess, 'real', v_a.real,
      'err', round(v_a.err::numeric, 3), 'guessers', v_a.guessers));
  else
    v_out := v_out || jsonb_build_object('oracle', null);
  end if;

  if p_full then
    select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group, m.user_id), 'name', m.display_name,
             'is_me', m.user_id = p_uid, 'out', public.olnu_g_live(m.user_id, v_night, p_now)) order by m.joined_at), '[]'::jsonb)
      into v_j from public.group_members m where m.group_id = p_group;
    v_out := v_out || jsonb_build_object('members', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'is_me', x.is_me, 'pts', x.pts) order by x.pts desc, x.name), '[]'::jsonb)
      into v_j
      from (select m.display_name as name, m.user_id = p_uid as is_me,
                   (select count(*) from public.game_agent_votes v
                      join public.game_agents a on a.group_id = v.group_id and a.night = v.night
                     where v.group_id = p_group and v.voter = m.user_id and v.suspect = a.agent and a.revealed_at is not null)
                   + 2 * (select count(*) from public.game_agents a
                           where a.group_id = p_group and a.agent = m.user_id and a.revealed_at is not null
                             and coalesce(a.correct, 0) = 0 and coalesce(a.votes, 0) >= 1) as pts
              from public.group_members m where m.group_id = p_group) x
     where x.pts > 0;
    v_out := v_out || jsonb_build_object('points', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'is_me', m.user_id = p_uid,
             'guess', g.guess, 'real', g.real, 'town', g.town) order by abs(g.guess - coalesce(g.real, 0))), '[]'::jsonb)
      into v_j
      from public.game_guesses g join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = v_prev;
    v_out := v_out || jsonb_build_object('guesses_prev', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'is_me', m.user_id = p_uid) order by g.created_at), '[]'::jsonb)
      into v_j
      from public.game_guesses g join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = v_night;
    v_out := v_out || jsonb_build_object('guessed', v_j);
  end if;

  return v_out || jsonb_build_object('night', v_night);
end;
$function$;
