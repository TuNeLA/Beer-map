-- public.events_near(p_lat double precision, p_lng double precision, p_days integer)
-- live md5(pg_get_functiondef) = df5e10a62759b06aa8e5f2bf71f1d2c2
CREATE OR REPLACE FUNCTION public.events_near(p_lat double precision, p_lng double precision, p_days integer DEFAULT 1)
 RETURNS TABLE(id bigint, title text, kind text, starts_at timestamp with time zone, ends_at timestamp with time zone, bar_id text, place text, lat double precision, lng double precision, town text, url text, source text, is_mine boolean, pending boolean, km double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(14, coalesce(p_days, 1)));
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  return query
  select e.id, e.title, e.kind, e.starts_at, e.ends_at, e.bar_id, e.place, e.lat, e.lng, e.town,
         case when e.status = 'ok' then e.url else null end, e.source,
         (e.created_by = v_uid), (e.status = 'pending'),
         round((sqrt(power((e.lat - p_lat) * 111.32, 2) + power((e.lng - p_lng) * 111.32 * cos(radians(p_lat)), 2)))::numeric, 1)::float8
    from public.bar_events e
   where (e.status = 'ok' or (e.status = 'pending' and e.created_by = v_uid))
     and e.expires_at > now()
     and e.starts_at < now() + make_interval(days => v_days)
     and e.starts_at > now() - interval '12 hours'
     and e.lat between p_lat - 0.27 and p_lat + 0.27
     and e.lng between p_lng - 0.27 / greatest(0.2, cos(radians(p_lat))) and p_lng + 0.27 / greatest(0.2, cos(radians(p_lat)))
   order by e.starts_at, e.id
   limit 100;
end; $function$;
