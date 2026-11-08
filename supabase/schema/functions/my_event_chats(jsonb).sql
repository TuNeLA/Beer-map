-- public.my_event_chats(p_seen jsonb)
-- live md5(pg_get_functiondef) = e1400e749de439e0888aa34eebf99c49
CREATE OR REPLACE FUNCTION public.my_event_chats(p_seen jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_seen jsonb := case when jsonb_typeof(p_seen) = 'object' then p_seen else '{}'::jsonb end;
begin
  return jsonb_build_object('v', 1, 'now', now(), 'chats', coalesce((
    select jsonb_agg(x.j order by x.s desc) from (
      select i.starts_at as s, jsonb_build_object(
        'group_id', t.group_id, 'invite_id', i.id, 'title', i.title, 'name', g.name, 'kind', i.kind, 'place', i.place,
        'starts_at', i.starts_at, 'open_until', t.open_until, 'hide_at', t.hide_at,
        'state', case when t.closed_at is not null or i.status <> 'open' then 'cancelled'
                      when now() >= t.open_until then 'archived' else 'open' end,
        'can_write', public.olnu_tg_access(t.group_id, v_uid) = 'write',
        'my_answer', p.answer, 'mine', i.creator = v_uid,
        'members', (select count(*) from public.invite_people q where q.invite_id = i.id and q.answer in ('yes', 'maybe')),
        'invited', (select count(*) from public.invite_people q where q.invite_id = i.id),
        'last_id', (select max(m.id) from public.group_msgs m where m.group_id = t.group_id and m.expires_at > now()),
        'unread', (select count(*) from (
            select 1 from public.group_msgs m
             where m.group_id = t.group_id and m.expires_at > now() and m.user_id <> v_uid
               and m.id > case when coalesce(v_seen ->> t.group_id::text, '') ~ '^[0-9]{1,18}$'
                               then (v_seen ->> t.group_id::text)::bigint else 0 end
             limit 99) z)) as j
        from public.invite_people p
        join public.temp_groups t on t.invite_id = p.invite_id
        join public.invites i on i.id = p.invite_id
        join public.groups g on g.id = t.group_id
       where p.user_id = v_uid and now() < t.hide_at
       order by i.starts_at desc
       limit 20) x), '[]'::jsonb));
end; $function$;
