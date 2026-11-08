-- public.card_public(p_kind text, p_id text, p_ip text)
-- live md5(pg_get_functiondef) = 63c9dcae661a4ee5e904eb58d4f05130
CREATE OR REPLACE FUNCTION public.card_public(p_kind text, p_id text DEFAULT NULL::text, p_ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_id text := upper(regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g'));
  g public.groups;
  c public.share_cards;
  r public.rallies;
  d public.duels;
  t public.duel_tokens;
  l public.ev_links;
  i public.invites;
  sa jsonb; sb jsonb;
  v_status text;
begin
  if not public.olnu_card_rl(p_ip) then return jsonb_build_object('ok', false, 'why', 'limited'); end if;
  if v_kind = 'invite' then
    return jsonb_build_object('ok', true, 'kind', 'invite', 'go', 'invite=1',
      'out', (select count(*) from public.beers b where b.expires_at > now() and not b.stopped and not coalesce(b.ghost, false))::int);
  end if;
  if v_kind = 'join' then
    if char_length(v_id) <> 6 then return jsonb_build_object('ok', false); end if;
    select * into g from public.groups x where upper(x.code) = v_id;
    if not found then return jsonb_build_object('ok', false); end if;
    return jsonb_build_object('ok', true, 'kind', 'join', 'go', 'join=' || g.code, 'group', g.name,
      'members', (select count(*) from public.group_members m where m.group_id = g.id)::int,
      'out', public.olnu_card_out(g.id), 'faces', public.olnu_card_faces(g.id));
  end if;
  if v_kind = 'ev' then
    if char_length(v_id) <> 6 then return jsonb_build_object('ok', false); end if;
    select * into l from public.ev_links x where x.token = v_id and x.expires_at > now();
    if not found then return jsonb_build_object('ok', false); end if;
    select * into i from public.invites x where x.id = l.invite_id;
    if not found or i.status <> 'open' then return jsonb_build_object('ok', false); end if;
    update public.ev_links x set hits = x.hits + 1 where x.token = l.token;
    return jsonb_build_object('ok', true, 'kind', 'ev', 'go', 'ev=' || l.token, 'title', i.title, 'place', i.place,
      'starts_at', i.starts_at, 'from', public.olnu_card_first(public.olnu_friend_name(l.creator)),
      'yes', (select count(*) from public.invite_people p where p.invite_id = i.id and p.answer = 'yes')::int,
      'maybe', (select count(*) from public.invite_people p where p.invite_id = i.id and p.answer = 'maybe')::int,
      'faces', public.olnu_ev_faces(i.id));
  end if;
  if v_kind = 'duelinv' then
    if char_length(v_id) <> 8 then return jsonb_build_object('ok', false); end if;
    select * into t from public.duel_tokens x where x.token = v_id and x.expires_at > now();
    if not found then return jsonb_build_object('ok', false, 'go', ''); end if;
    return jsonb_build_object('ok', true, 'kind', 'duelinv', 'go', 'duel=' || t.token,
      'group', (select x.name from public.groups x where x.id = t.group_id),
      'members', (select count(*) from public.group_members m where m.group_id = t.group_id)::int,
      'out', public.olnu_card_out(t.group_id), 'expires_at', t.expires_at);
  end if;
  if v_kind not in ('group', 'rally', 'duel', 'paper') or char_length(v_id) <> 10 then return jsonb_build_object('ok', false); end if;
  update public.share_cards s set hits = s.hits + 1, last_hit_at = now()
   where s.token = v_id and s.kind = v_kind and s.expires_at > now()
   returning * into c;
  if not found then return jsonb_build_object('ok', false); end if;
  select * into g from public.groups x where x.id = c.group_id;
  if not found then return jsonb_build_object('ok', false); end if;
  if v_kind = 'group' then
    return jsonb_build_object('ok', true, 'kind', 'group', 'go', 'chat=' || g.id::text, 'group', g.name,
      'members', (select count(*) from public.group_members m where m.group_id = g.id)::int,
      'out', public.olnu_card_out(g.id), 'faces', public.olnu_card_faces(g.id));
  end if;
  if v_kind = 'paper' then
    return jsonb_build_object('ok', true, 'kind', 'paper', 'go', '', 'group', g.name,
      'members', (select count(*) from public.group_members m where m.group_id = g.id)::int,
      'people', (select count(*) from public.group_members m join public.beers b on b.user_id = m.user_id
                  where m.group_id = g.id and b.expires_at > now() - interval '20 hours' and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0)::int,
      'drinks', (select coalesce(sum(coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)), 0) from public.group_members m join public.beers b on b.user_id = m.user_id
                  where m.group_id = g.id and b.expires_at > now() - interval '20 hours')::int);
  end if;
  if v_kind = 'rally' then
    select * into r from public.rallies x where x.id = c.ref_id;
    if not found then return jsonb_build_object('ok', false); end if;
    return jsonb_build_object('ok', true, 'kind', 'rally', 'go', 'rally=' || r.id::text, 'group', g.name,
      'place', r.place,
      'sender', public.olnu_card_first((select m.display_name from public.group_members m where m.group_id = r.group_id and m.user_id = r.user_id)),
      'yes', (select count(*) from public.rally_answers a where a.rally_id = r.id and a.answer = 'yes')::int,
      'maybe', (select count(*) from public.rally_answers a where a.rally_id = r.id and a.answer = 'maybe')::int,
      'live', not r.closed and r.expires_at > now(), 'at', r.created_at);
  end if;
  select * into d from public.duels x where x.id = c.ref_id;
  if not found then return jsonb_build_object('ok', false); end if;
  v_status := case when d.status = 'active' and (d.finished_at is not null or d.ends_at <= now()) then 'done'
                   when d.status = 'pending' and (d.answer_by <= now() or d.ends_at <= now()) then 'expired'
                   else d.status end;
  if d.finished_at is not null then
    sa := jsonb_build_object('drinks', d.drinks_a); sb := jsonb_build_object('drinks', d.drinks_b);
  elsif d.status = 'active' then
    sa := public.olnu_duel_side(d.id, 'a'); sb := public.olnu_duel_side(d.id, 'b');
  else
    sa := jsonb_build_object('drinks', 0); sb := jsonb_build_object('drinks', 0);
  end if;
  return jsonb_build_object('ok', true, 'kind', 'duel', 'go', '', 'status', v_status,
    'group', (select x.name from public.groups x where x.id = case when d.group_a = c.group_id then d.group_a else d.group_b end),
    'opp', (select x.name from public.groups x where x.id = case when d.group_a = c.group_id then d.group_b else d.group_a end),
    'us', coalesce((case when d.group_a = c.group_id then sa else sb end)->>'drinks', '0')::int,
    'them', coalesce((case when d.group_a = c.group_id then sb else sa end)->>'drinks', '0')::int,
    'winner', case when d.winner is null then null when d.winner = 'draw' then 'draw'
                   when (d.winner = 'a') = (d.group_a = c.group_id) then 'us' else 'them' end);
end; $function$;
