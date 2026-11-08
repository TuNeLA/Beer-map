-- public.walk_timer_set(p_walk_id bigint, p_minutes integer)
-- live md5(pg_get_functiondef) = 256ac73cd85a79b7beb9a47521fae19c
CREATE OR REPLACE FUNCTION public.walk_timer_set(p_walk_id bigint, p_minutes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); w public.walks; t public.gw_walk_timers; v_m int := coalesce(p_minutes, 0);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_m < 10 or v_m > 110 then raise exception 'invalid_minutes'; end if;
  select * into w from public.walks x where x.id = p_walk_id and x.user_id = v_uid;
  if w.id is null or w.ended_at is not null then raise exception 'walk_not_found'; end if;
  if exists (select 1 from public.gw_walk_timers x where x.walk_id = w.id and x.updated_at > now() - interval '2 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.gw_walk_timers as x (walk_id, user_id, minutes, due_at)
  values (w.id, v_uid, v_m, now() + make_interval(mins => v_m))
  on conflict (walk_id) do update set minutes = excluded.minutes, due_at = excluded.due_at, reminded_at = null,
    alert_at = null, ok_at = null, cancelled_at = null,
    remind_pushed = false, alert_pushed = false, updated_at = now()
  returning * into t;
  return public.olnu_gw_walk_state(t);
end $function$;
