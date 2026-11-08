-- public.olnu_duel_json(p_duel bigint, p_uid uuid)
-- live md5(pg_get_functiondef) = 86a18c844ce50ab9cc6f84c711185366
CREATE OR REPLACE FUNCTION public.olnu_duel_json(p_duel bigint, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d public.duels;
  in_a boolean; in_b boolean;
  s public.duel_sides;
  me text; op text;
  ga uuid; gb uuid;
  su jsonb; st jsonb;
  v_status text;
begin
  select * into d from public.duels x where x.id = p_duel;
  if not found then return null; end if;
  in_a := public.olnu_wd_member(d.group_a, p_uid);
  in_b := public.olnu_wd_member(d.group_b, p_uid);
  if not in_a and not in_b then return null; end if;
  select * into s from public.duel_sides x where x.duel_id = d.id and x.user_id = p_uid;
  me := case when in_a and in_b then coalesce(s.side, 'a') when in_a then 'a' else 'b' end;
  op := case when me = 'a' then 'b' else 'a' end;
  ga := case when me = 'a' then d.group_a else d.group_b end;
  gb := case when me = 'a' then d.group_b else d.group_a end;
  v_status := case when d.status = 'active' and d.finished_at is not null then 'done'
                   when d.status = 'active' and d.ends_at <= now() then 'done'
                   when d.status = 'pending' and (d.answer_by <= now() or d.ends_at <= now()) then 'expired'
                   else d.status end;
  if d.finished_at is not null then
    su := jsonb_build_object('drinks', case when me = 'a' then d.drinks_a else d.drinks_b end,
                             'spirit', case when me = 'a' then d.spirit_a else d.spirit_b end);
    st := jsonb_build_object('drinks', case when me = 'a' then d.drinks_b else d.drinks_a end,
                             'spirit', case when me = 'a' then d.spirit_b else d.spirit_a end);
    su := su || jsonb_build_object('members', (public.olnu_duel_side(d.id, me, d.ends_at))->'members');
    st := st || jsonb_build_object('members', (public.olnu_duel_side(d.id, op, d.ends_at))->'members');
  else
    su := public.olnu_duel_side(d.id, me);
    st := public.olnu_duel_side(d.id, op);
  end if;
  return jsonb_build_object(
    'id', d.id, 'status', v_status, 'via', d.via,
    'incoming', v_status = 'pending' and me = 'b' and not (in_a and in_b),
    'outgoing', v_status = 'pending' and me = 'a',
    'created_at', d.created_at, 'answer_by', d.answer_by, 'accepted_at', d.accepted_at, 'ends_at', d.ends_at,
    'finished_at', d.finished_at,
    'group', jsonb_build_object('id', ga, 'name', (select g.name from public.groups g where g.id = ga), 'wins', public.olnu_duel_wins(ga)),
    'opp', jsonb_build_object('name', (select g.name from public.groups g where g.id = gb),
                              'members', (select count(*) from public.group_members m where m.group_id = gb)::int,
                              'wins', public.olnu_duel_wins(gb)),
    'us', su, 'them', st,
    'both', in_a and in_b,
    'needs_pick', in_a and in_b and s.side is null and v_status in ('pending', 'active'),
    'pick', case when s.side is null then null else jsonb_build_object(
              'group_id', case when s.side = 'a' then d.group_a else d.group_b end,
              'can_switch', s.changes = 0 and s.first_at > now() - interval '10 minutes' and v_status in ('pending', 'active'),
              'locked_at', case when s.changes > 0 then s.changed_at else s.first_at + interval '10 minutes' end) end,
    'sides', case when in_a and in_b then jsonb_build_array(
               jsonb_build_object('id', d.group_a, 'name', (select g.name from public.groups g where g.id = d.group_a)),
               jsonb_build_object('id', d.group_b, 'name', (select g.name from public.groups g where g.id = d.group_b)))
             else null end,
    'winner', case when d.winner is null then null when d.winner = 'draw' then 'draw' when d.winner = me then 'us' else 'them' end);
end; $function$;
