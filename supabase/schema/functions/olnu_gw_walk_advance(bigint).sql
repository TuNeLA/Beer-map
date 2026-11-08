-- public.olnu_gw_walk_advance(p_walk bigint)
-- live md5(pg_get_functiondef) = ddd9872f89320cb7008095bc7e506a8a
CREATE OR REPLACE FUNCTION public.olnu_gw_walk_advance(p_walk bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.gw_walk_timers t set
      ok_at = case when w.end_reason = 'home' then coalesce(w.ended_at, now()) else t.ok_at end,
      cancelled_at = case when coalesce(w.end_reason, '') in ('stop', 'replaced') and t.alert_at is null then coalesce(w.ended_at, now()) else t.cancelled_at end,
      last_lat = case when w.ended_at is null and w.lat is not null then round(w.lat::numeric, 4)::float8 else t.last_lat end,
      last_lng = case when w.ended_at is null and w.lng is not null then round(w.lng::numeric, 4)::float8 else t.last_lng end,
      last_at  = case when w.ended_at is null and w.lat is not null then coalesce(w.pos_at, now()) else t.last_at end,
      reminded_at = case when coalesce(w.end_reason, '') not in ('home', 'stop', 'replaced')
                          and t.reminded_at is null and now() >= t.due_at then now() else t.reminded_at end,
      alert_at = case when coalesce(w.end_reason, '') not in ('home', 'stop', 'replaced')
                       and t.alert_at is null and t.reminded_at is not null and now() >= t.reminded_at + interval '30 seconds' then now() else t.alert_at end,
      updated_at = now()
    from public.walks w
   where w.id = t.walk_id and t.ok_at is null and t.cancelled_at is null and t.created_at > now() - interval '6 hours'
     and (p_walk is null or t.walk_id = p_walk);
end $function$;
