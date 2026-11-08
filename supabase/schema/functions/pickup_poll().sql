-- public.pickup_poll()
-- live md5(pg_get_functiondef) = bce5a0ad141f5d08f31984a4b16364ee
CREATE OR REPLACE FUNCTION public.pickup_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_mine jsonb; v_in jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_pickup_sweep();
  select public.olnu_pickup_mine(x) into v_mine from public.pickup_reqs x
   where x.user_id = v_uid and (x.ended_at is null or x.ended_at > now() - interval '10 minutes')
   order by x.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'kind', x.kind, 'name', public.olnu_walk_name(x.user_id, x.group_id),
           'live', x.ended_at is null,
           'lat', case when x.ended_at is null then x.lat end, 'lng', case when x.ended_at is null then x.lng end,
           'acc', case when x.ended_at is null then x.acc end, 'pos_at', x.pos_at,
           'created_at', x.created_at, 'ends_at', x.ends_at, 'ended_at', x.ended_at, 'end_reason', x.end_reason,
           'my_ans', (select a.ans from public.pickup_answers a where a.req_id = x.id and a.user_id = v_uid),
           'coming', (select count(*) from public.pickup_answers a where a.req_id = x.id and a.ans = 'kommer'))
         order by x.created_at desc), '[]'::jsonb)
    into v_in
    from (select * from public.pickup_reqs x
           where v_uid = any (x.to_users) and x.user_id <> v_uid and not public.olnu_ub_hidden(v_uid, x.user_id)
             and (x.ended_at is null or x.ended_at > now() - interval '15 minutes')
           order by x.created_at desc limit 10) x;
  return jsonb_build_object('v', 1, 'now', now(), 'mine', v_mine, 'incoming', v_in,
    'driving', exists (select 1 from public.driver_status d where d.user_id = v_uid and d.night = public.olnu_night_of(now())));
end; $function$;
