-- public.olnu_gw_walk_claim(p_walk bigint, p_limit integer)
-- live md5(pg_get_functiondef) = 2d22ef48963d4de2ed859ae78fa4b7e3
CREATE OR REPLACE FUNCTION public.olnu_gw_walk_claim(p_walk bigint, p_limit integer)
 RETURNS TABLE(walk_id bigint, stage text, user_id uuid, viewers uuid[], name text, due_at timestamp with time zone, last_lat double precision, last_lng double precision, last_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with c as (
    update public.gw_walk_timers t set remind_pushed = true, updated_at = now()
     where t.reminded_at is not null and not t.remind_pushed and t.alert_at is null and t.ok_at is null and t.cancelled_at is null
       and (p_walk is null or t.walk_id = p_walk) and t.reminded_at > now() - interval '2 hours'
       and t.walk_id in (select x.walk_id from public.gw_walk_timers x where x.reminded_at is not null and not x.remind_pushed
                          and (p_walk is null or x.walk_id = p_walk) order by x.reminded_at limit greatest(1, least(100, coalesce(p_limit, 50))))
    returning t.walk_id, 'remind'::text as stage, t.user_id, t.due_at, t.last_lat, t.last_lng, t.last_at
  ), a as (
    update public.gw_walk_timers t set alert_pushed = true, remind_pushed = true, updated_at = now()
     where t.alert_at is not null and not t.alert_pushed and t.ok_at is null and t.cancelled_at is null
       and (p_walk is null or t.walk_id = p_walk) and t.alert_at > now() - interval '2 hours'
       and t.walk_id in (select x.walk_id from public.gw_walk_timers x where x.alert_at is not null and not x.alert_pushed
                          and (p_walk is null or x.walk_id = p_walk) order by x.alert_at limit greatest(1, least(100, coalesce(p_limit, 50))))
    returning t.walk_id, 'alert'::text as stage, t.user_id, t.due_at, t.last_lat, t.last_lng, t.last_at
  )
  select z.walk_id, z.stage, z.user_id, w.viewers, public.olnu_card_first(public.olnu_gw_name_for(z.user_id, null)),
         z.due_at, z.last_lat, z.last_lng, z.last_at
    from (select * from c union all select * from a) z join public.walks w on w.id = z.walk_id;
end $function$;
