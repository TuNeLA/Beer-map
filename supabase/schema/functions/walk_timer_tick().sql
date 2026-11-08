-- public.walk_timer_tick()
-- live md5(pg_get_functiondef) = 59b7d3f2e22f5a9d835ff902c494473a
CREATE OR REPLACE FUNCTION public.walk_timer_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); r record; v_mine jsonb; v_alerts jsonb; v_push jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  for r in
    select t.walk_id from public.gw_walk_timers t join public.walks w on w.id = t.walk_id
     where (t.user_id = v_uid or v_uid = any (w.viewers)) and t.ok_at is null and t.cancelled_at is null
       and t.created_at > now() - interval '6 hours'
     limit 20
  loop
    perform public.olnu_gw_walk_advance(r.walk_id);
    if exists (select 1 from public.gw_walk_timers t where t.walk_id = r.walk_id
                and ((t.reminded_at is not null and not t.remind_pushed) or (t.alert_at is not null and not t.alert_pushed))) then
      v_push := v_push || to_jsonb(r.walk_id);
    end if;
  end loop;
  select public.olnu_gw_walk_state(t) into v_mine from public.gw_walk_timers t
   where t.user_id = v_uid and t.created_at > now() - interval '6 hours' and t.ok_at is null and t.cancelled_at is null
   order by t.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('walk_id', t.walk_id,
           'name', public.olnu_card_first(public.olnu_gw_name_for(t.user_id, v_uid)),
           'due_at', t.due_at, 'alert_at', t.alert_at, 'last_lat', t.last_lat, 'last_lng', t.last_lng, 'last_at', t.last_at,
           'ok_at', t.ok_at) order by t.alert_at desc), '[]'::jsonb)
    into v_alerts
    from public.gw_walk_timers t join public.walks w on w.id = t.walk_id
   where v_uid = any (w.viewers) and t.user_id <> v_uid and t.alert_at is not null and t.alert_at > now() - interval '3 hours';
  return jsonb_build_object('v', 1, 'mine', v_mine, 'alerts', v_alerts, 'push', v_push);
end $function$;
