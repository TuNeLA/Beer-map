-- public.olnu_pickup_mine(r pickup_reqs)
-- live md5(pg_get_functiondef) = 8820a46e07c6309790fa683d49620c16
CREATE OR REPLACE FUNCTION public.olnu_pickup_mine(r pickup_reqs)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', r.id, 'kind', r.kind, 'live', r.ended_at is null and r.ends_at > now(),
    'created_at', r.created_at, 'ends_at', r.ends_at, 'ended_at', r.ended_at, 'end_reason', r.end_reason,
    'n', coalesce(array_length(r.to_users, 1), 0), 'has_pos', r.lat is not null,
    'driver', case when r.kind = 'skjuts' then public.olnu_walk_name(r.to_users[1], r.group_id) end,
    'answers', coalesce((select jsonb_agg(jsonb_build_object('name', public.olnu_walk_name(a.user_id, r.group_id), 'ans', a.ans, 'at', a.at)
                          order by (a.ans = 'kommer') desc, a.at)
                          from public.pickup_answers a where a.req_id = r.id), '[]'::jsonb));
$function$;
