-- public.walk_poll()
-- live md5(pg_get_functiondef) = b3d6da63e6e991ffbc8d64e5d96e672c
CREATE OR REPLACE FUNCTION public.walk_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); v_mine jsonb; v_w jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_walk_sweep();
  select public.olnu_walk_mine(x) into v_mine from public.walks x
   where x.user_id = v_uid and (x.ended_at is null or x.ended_at > now() - interval '10 minutes')
   order by x.started_at desc limit 1;
  insert into public.walk_views (walk_id, user_id, seen_at)
  select x.id, v_uid, now() from public.walks x
   where v_uid = any (x.viewers) and x.ended_at is null and x.ends_at > now()
  on conflict (walk_id, user_id) do update set seen_at = excluded.seen_at;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'name', public.olnu_walk_name(x.user_id, x.group_id),
           'group_name', (select g.name from public.groups g where g.id = x.group_id),
           'live', x.ended_at is null,
           'lat', case when x.ended_at is null then x.lat end, 'lng', case when x.ended_at is null then x.lng end,
           'acc', case when x.ended_at is null then x.acc end,
           'pos_at', x.pos_at, 'age_s', case when x.pos_at is not null then extract(epoch from now() - x.pos_at)::int end,
           'home_lat', x.home_lat, 'home_lng', x.home_lng, 'start_dist', x.start_dist,
           'started_at', x.started_at, 'ends_at', x.ends_at, 'ended_at', x.ended_at, 'end_reason', x.end_reason)
         order by x.started_at desc), '[]'::jsonb)
    into v_w
    from (select * from public.walks x
           where v_uid = any (x.viewers) and x.user_id <> v_uid
             and (x.ended_at is null or x.ended_at > now() - interval '15 minutes')
           order by x.started_at desc limit 10) x;
  return jsonb_build_object('v', 1, 'now', now(), 'mine', v_mine, 'watching', v_w);
end; $function$;
