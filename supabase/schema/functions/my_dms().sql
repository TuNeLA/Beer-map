-- public.my_dms()
-- live md5(pg_get_functiondef) = f53831e0eb8cf5270e0ad4da3aa2971c
CREATE OR REPLACE FUNCTION public.my_dms()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
  v_n int;
begin
  with t as (
    select d.group_id, d.created_by, d.created_at,
           case when d.a = v_uid then d.b else d.a end as other
      from public.dm_threads d where d.a = v_uid or d.b = v_uid
  ), x as (
    select t.*, lm.id as last_id, lm.body as last_body, lm.created_at as last_at, lm.user_id = v_uid as last_me,
           coalesce(s.seen_id, 0) as my_seen, coalesce(s.muted, false) as muted
      from t
      left join lateral (select m.id, m.body, m.created_at, m.user_id from public.group_msgs m
                          where m.group_id = t.group_id and m.expires_at > now() order by m.id desc limit 1) lm on true
      left join public.dm_state s on s.group_id = t.group_id and s.user_id = v_uid
     where lm.id is not null or (t.created_by = v_uid and t.created_at > now() - interval '1 hour')
     order by coalesce(lm.created_at, t.created_at) desc
     limit 50
  ), y as (
    select x.*, (select count(*) from (select 1 from public.group_msgs m
                   where m.group_id = x.group_id and m.expires_at > now() and m.user_id <> v_uid and m.id > x.my_seen limit 99) z)::int as unread
      from x
  )
  select coalesce(jsonb_agg(public.olnu_dm_json(y.group_id, v_uid) || jsonb_build_object(
           'last_id', y.last_id, 'last_body', left(y.last_body, 80), 'last_at', y.last_at, 'last_me', coalesce(y.last_me, false),
           'unread', y.unread, 'at', coalesce(y.last_at, y.created_at), 'out', coalesce((select po.is_out from public.olnu_friend_out(y.other) po limit 1), false))
         order by coalesce(y.last_at, y.created_at) desc), '[]'::jsonb),
         coalesce(sum(y.unread), 0)::int
    into v, v_n from y;
  return jsonb_build_object('v', 1, 'now', now(), 'unread', v_n, 'threads', v);
end; $function$;
