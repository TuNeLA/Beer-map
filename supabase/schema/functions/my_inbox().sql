-- public.my_inbox()
-- live md5(pg_get_functiondef) = 4adeb7cb149b0dd971561f2646dd2430
CREATE OR REPLACE FUNCTION public.my_inbox()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_items jsonb := '[]'::jsonb;
  v_part jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('k', 'friend:' || f.id, 'type', 'friend', 'id', f.id,
           'name', public.olnu_friend_name(f.requester), 'home_town', public.olnu_home_town(f.requester), 'at', f.updated_at)), '[]'::jsonb)
    into v_part
    from (select * from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'pending' and x.requester <> v_uid and (not public.olnu_is_test_user(x.requester) or public.olnu_is_test_user(v_uid))
           order by x.updated_at desc limit 10) f;
  v_items := v_items || v_part;

  select coalesce(jsonb_agg(jsonb_build_object('k', 'inv:' || i.id, 'type', 'inv', 'id', i.id, 'title', i.title,
           'starts_at', i.starts_at, 'place', i.place, 'from', public.olnu_card_first(public.olnu_friend_name(coalesce(p.invited_by, i.creator))),
           'group_name', (select g.name from public.groups g where g.id = i.group_id), 'at', p.created_at)), '[]'::jsonb)
    into v_part
    from public.invite_people p join public.invites i on i.id = p.invite_id
   where p.user_id = v_uid and p.answer = 'none' and i.creator <> v_uid and (not public.olnu_is_test_user(i.creator) or public.olnu_is_test_user(v_uid)) and i.status = 'open' and i.ends_at > now()
     and p.created_at > now() - interval '30 days';
  v_items := v_items || v_part;

  select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_part from (
    select jsonb_build_object('k', 'rsvp:' || i.id || ':' || md5(p.user_id::text || 'olnu-ib')::text, 'type', 'rsvp', 'id', i.id, 'title', i.title,
             'name', public.olnu_card_first(public.olnu_friend_name(p.user_id)), 'answer', p.answer, 'starts_at', i.starts_at, 'at', p.answered_at) as j
      from public.invite_people p join public.invites i on i.id = p.invite_id
     where i.creator = v_uid and p.user_id <> v_uid and p.answer in ('yes', 'maybe')
       and p.answered_at > now() - interval '24 hours' and i.ends_at > now()
     order by p.answered_at desc limit 10) x;
  v_items := v_items || v_part;

  select coalesce(jsonb_agg(jsonb_build_object('k', 'status:' || s.id, 'type', 'status', 'id', s.id, 'group_id', s.group_id,
           'group_name', g.name, 'from', (select m2.display_name from public.group_members m2 where m2.group_id = s.group_id and m2.user_id = s.user_id),
           'ends_at', s.ends_at, 'at', s.created_at)), '[]'::jsonb)
    into v_part
    from public.status_reqs s
    join public.group_members m on m.group_id = s.group_id and m.user_id = v_uid
    join public.groups g on g.id = s.group_id
   where s.user_id <> v_uid and s.created_at > now() - interval '60 minutes'
     and not exists (select 1 from public.status_answers a where a.req_id = s.id and a.user_id = v_uid);
  v_items := v_items || v_part;

  select coalesce(jsonb_agg(jsonb_build_object('k', 'rally:' || r.id, 'type', 'rally', 'id', r.id, 'group_id', r.group_id,
           'group_name', r.group_name, 'name', r.name, 'body', r.body, 'place', r.place, 'yes', r.yes, 'at', r.created_at)), '[]'::jsonb)
    into v_part
    from public.olnu_rally_rows(v_uid, null) r
   where not r.is_mine and r.my_answer is null;
  v_items := v_items || v_part;

  select coalesce(jsonb_agg(jsonb_build_object('k', 'duel:' || d.id, 'type', 'duel', 'id', d.id, 'group_id', d.group_b,
           'group_name', (select g.name from public.groups g where g.id = d.group_b),
           'opp', (select g.name from public.groups g where g.id = d.group_a),
           'answer_by', d.answer_by, 'at', d.created_at)), '[]'::jsonb)
    into v_part
    from public.duels d
   where d.status = 'pending' and d.answer_by > now() and d.ends_at > now()
     and exists (select 1 from public.group_members m where m.group_id = d.group_b and m.user_id = v_uid)
     and not exists (select 1 from public.group_members m where m.group_id = d.group_a and m.user_id = v_uid);
  v_items := v_items || v_part;

  select coalesce(jsonb_agg(e order by (e->>'at')::timestamptz desc nulls last), '[]'::jsonb) into v_items
    from (select e from jsonb_array_elements(v_items) e order by (e->>'at')::timestamptz desc nulls last limit 40) q;
  return jsonb_build_object('v', 1, 'now', now(), 'items', v_items);
end;
$function$;
