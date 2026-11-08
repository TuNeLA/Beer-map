-- public.gang_poll()
-- live md5(pg_get_functiondef) = a0763ee3b5c1ba8a4d2dc41de7ffd5e6
CREATE OR REPLACE FUNCTION public.gang_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_last timestamptz := public.olnu_gang_last_night();
  v_groups jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.joined), '[]'::jsonb) into v_groups from (
    select gm.joined_at as joined, jsonb_build_object(
      'id', g.id, 'name', g.name,
      'mt_open', exists (select 1 from public.gang_mt_rounds r where r.group_id = g.id and r.night = v_night and not public.olnu_gang_mt_done(r)),
      'mt_voted', exists (select 1 from public.gang_mt_rounds r join public.gang_mt_votes v on v.round_id = r.id and v.voter = v_uid
                           where r.group_id = g.id and r.night = v_night and not public.olnu_gang_mt_done(r)),
      'mt_last', (select r.id from public.gang_mt_rounds r where r.group_id = g.id and r.night = v_night order by r.id desc limit 1),
      'poll_open', exists (select 1 from public.gang_polls p where p.group_id = g.id and p.ended_at is null and p.ends_at > now()),
      'poll_id', (select p.id from public.gang_polls p where p.group_id = g.id and (p.ended_at is null or p.ended_at > now() - interval '60 minutes') order by p.id desc limit 1),
      'poll_voted', exists (select 1 from public.gang_polls p join public.gang_poll_votes v on v.poll_id = p.id and v.user_id = v_uid
                             where p.group_id = g.id and p.ended_at is null and p.ends_at > now()),
      'poll_winner', (select p.options -> p.winner ->> 'name' from public.gang_polls p
                       where p.group_id = g.id and p.ended_at > now() - interval '60 minutes' and p.winner is not null
                       order by p.id desc limit 1),
      'poll_due', exists (select 1 from public.gang_polls p where p.group_id = g.id and p.ended_at is null and p.ends_at <= now()),
      'brunch', (select jsonb_build_object('id', b.id, 'by', public.olnu_gang_name(g.id, b.user_id), 'by_me', b.user_id = v_uid,
                   'place', b.place, 'at_time', b.at_time,
                   'mine', (select a.answer from public.gang_brunch_answers a where a.brunch_id = b.id and a.user_id = v_uid),
                   'ja', (select count(*) from public.gang_brunch_answers a join public.group_members m2 on m2.group_id = g.id and m2.user_id = a.user_id
                           where a.brunch_id = b.id and a.answer = 'ja')::int)
                   from public.gang_brunches b where b.group_id = g.id and not b.closed and b.expires_at > now() order by b.id desc limit 1),
      'quotes_pending', (select count(*) from public.gang_quotes q where q.group_id = g.id and not q.hidden and q.reveal_at > now())::int,
      'quotes_yday', (select count(*) from public.gang_quotes q where q.group_id = g.id and not q.hidden and q.night = v_last and q.reveal_at <= now())::int,
      'paper', exists (select 1 from public.group_members m3
                        where m3.group_id = g.id and (
                          exists (select 1 from public.medal_nights n where n.user_id = m3.user_id and n.night = v_last and n.beers + n.others > 0)
                          or exists (select 1 from public.medal_checkins c where c.user_id = m3.user_id and c.night = v_last))),
      'debt_net', (select coalesce(sum(case when d.creditor = v_uid then d.amount else -d.amount end), 0)::int
                     from public.gang_debts d where d.group_id = g.id and d.paid_at is null and d.cancelled_at is null
                      and (d.creditor = v_uid or d.debtor = v_uid)
                      and d.debtor in (select m4.user_id from public.group_members m4 where m4.group_id = g.id)
                      and d.creditor in (select m4.user_id from public.group_members m4 where m4.group_id = g.id))
    ) as j
    from public.group_members gm join public.groups g on g.id = gm.group_id
   where gm.user_id = v_uid
   order by gm.joined_at limit 20) x;
  return jsonb_build_object('v', 1, 'server_time', now(), 'night', v_night, 'last_night', v_last,
                            'hour', public.olnu_gang_hour(), 'groups', v_groups);
end; $function$;
