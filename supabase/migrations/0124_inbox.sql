-- 0124 (social2) 🔔 Inkorg: ONE list of things that wait for me, in one call.
-- my_inbox() → jsonb {v, now, items:[...]} newest first, max 40. Item kinds (each has k = stable key, type, at):
--   friend  {id (friendship id), name, home_town}                       pending friend request TO me  → friend_answer
--   inv     {id, title, starts_at, place, from, group_name}             event invite, I have not answered → invite_answer
--   rsvp    {id, title, name, answer, starts_at}                        someone said ✅/🤔 to MY event (last 24 h)
--   status  {id, group_id, group_name, from, ends_at}                   open lägesrapport in my group, not answered by me
--   rally   {id, group_id, group_name, name, body, place, yes}          live call-out, not mine, not answered → answer_rally
--   duel    {id, group_id, group_name, opp, answer_by}                  duel challenge to my group, waiting → duel_answer
-- Names: display_name in that group / olnu_friend_name. Never user ids, never positions. Read-only.
-- Reuses olnu_rally_rows (0025/v22) and the same rules as near_poll / my_invites / duel_poll / chief.
-- No row is ever removed by this file. Safe to run again.

create or replace function public.my_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_items jsonb := '[]'::jsonb;
  v_part jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- friend requests to me
  select coalesce(jsonb_agg(jsonb_build_object('k', 'friend:' || f.id, 'type', 'friend', 'id', f.id,
           'name', public.olnu_friend_name(f.requester), 'home_town', public.olnu_home_town(f.requester), 'at', f.updated_at)), '[]'::jsonb)
    into v_part
    from (select * from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'pending' and x.requester <> v_uid
           order by x.updated_at desc limit 10) f;
  v_items := v_items || v_part;

  -- event invites I have not answered
  select coalesce(jsonb_agg(jsonb_build_object('k', 'inv:' || i.id, 'type', 'inv', 'id', i.id, 'title', i.title,
           'starts_at', i.starts_at, 'place', i.place, 'from', public.olnu_card_first(public.olnu_friend_name(coalesce(p.invited_by, i.creator))),
           'group_name', (select g.name from public.groups g where g.id = i.group_id), 'at', p.created_at)), '[]'::jsonb)
    into v_part
    from public.invite_people p join public.invites i on i.id = p.invite_id
   where p.user_id = v_uid and p.answer = 'none' and i.creator <> v_uid and i.status = 'open' and i.ends_at > now()
     and p.created_at > now() - interval '30 days';
  v_items := v_items || v_part;

  -- RSVPs to my events (last 24 h)
  select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_part from (
    select jsonb_build_object('k', 'rsvp:' || i.id || ':' || md5(p.user_id::text || 'olnu-ib')::text, 'type', 'rsvp', 'id', i.id, 'title', i.title,
             'name', public.olnu_card_first(public.olnu_friend_name(p.user_id)), 'answer', p.answer, 'starts_at', i.starts_at, 'at', p.answered_at) as j
      from public.invite_people p join public.invites i on i.id = p.invite_id
     where i.creator = v_uid and p.user_id <> v_uid and p.answer in ('yes', 'maybe')
       and p.answered_at > now() - interval '24 hours' and i.ends_at > now()
     order by p.answered_at desc limit 10) x;
  v_items := v_items || v_part;

  -- open status requests (lägesrapport) in my groups that I have not answered (answers taken until 60 min after start)
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

  -- live call-outs, not mine, not answered
  select coalesce(jsonb_agg(jsonb_build_object('k', 'rally:' || r.id, 'type', 'rally', 'id', r.id, 'group_id', r.group_id,
           'group_name', r.group_name, 'name', r.name, 'body', r.body, 'place', r.place, 'yes', r.yes, 'at', r.created_at)), '[]'::jsonb)
    into v_part
    from public.olnu_rally_rows(v_uid, null) r
   where not r.is_mine and r.my_answer is null;
  v_items := v_items || v_part;

  -- duel challenges waiting for my group (I am in the challenged group only)
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
$$;

revoke all on function public.my_inbox() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.my_inbox() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.my_inbox() to authenticated'; end if;
end $$;
