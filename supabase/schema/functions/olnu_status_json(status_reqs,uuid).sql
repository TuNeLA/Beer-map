-- public.olnu_status_json(r status_reqs, p_uid uuid)
-- live md5(pg_get_functiondef) = 6a4bb8cdec5d58c12973320f428627b8
CREATE OR REPLACE FUNCTION public.olnu_status_json(r status_reqs, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mem as (
    select m.user_id, m.display_name, m.joined_at from public.group_members m where m.group_id = r.group_id
  ), ans as (
    select a.user_id, a.photo_id, a.msg_id, a.created_at,
           (a.created_at <= r.ends_at) as in_time,
           row_number() over (order by a.created_at, a.user_id) as rk
      from public.status_answers a
      join mem on mem.user_id = a.user_id
     where a.req_id = r.id
  ), need as (
    select mem.* from mem where mem.joined_at <= r.created_at and mem.user_id <> r.user_id
  )
  select jsonb_build_object(
    'id', r.id, 'group_id', r.group_id,
    'group_name', (select g.name from public.groups g where g.id = r.group_id),
    'by', public.olnu_chief_name(r.group_id, r.user_id), 'by_me', r.user_id = p_uid,
    'created_at', r.created_at, 'ends_at', r.ends_at, 'now', now(),
    'late_until', r.created_at + interval '60 minutes',
    'needed', (select count(*) from need)::int,
    'answered', (select count(*) from ans a where a.in_time and a.user_id in (select user_id from need))::int,
    'done', now() >= r.ends_at
            or ((select count(*) from need) > 0
                and (select count(*) from ans a where a.in_time and a.user_id in (select user_id from need))
                    >= (select count(*) from need)),
    'mine', exists (select 1 from ans a where a.user_id = p_uid),
    'answers', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_chief_k(r.group_id, a.user_id), 'name', public.olnu_chief_name(r.group_id, a.user_id),
        'is_me', a.user_id = p_uid, 'is_chief', a.user_id = r.user_id,
        'photo_id', a.photo_id, 'msg_id', a.msg_id, 'at', a.created_at,
        'sec', greatest(0, floor(extract(epoch from (a.created_at - r.created_at))))::int,
        'in_time', a.in_time, 'rank', a.rk) order by a.created_at, a.user_id) from ans a), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_chief_k(r.group_id, n.user_id), 'name', n.display_name, 'is_me', n.user_id = p_uid)
        order by n.display_name)
        from need n where not exists (select 1 from ans a where a.user_id = n.user_id)), '[]'::jsonb));
$function$;
