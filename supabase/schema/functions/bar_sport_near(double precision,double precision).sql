-- public.bar_sport_near(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 01e840a10250ee05c8833cf0c09cf2b2
CREATE OR REPLACE FUNCTION public.bar_sport_near(p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_cos float8;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_cos := greatest(0.2, cos(radians(p_lat)));
  return jsonb_build_object('bars', coalesce((
    select jsonb_agg(z.j order by (z.j->>'shows')::boolean desc, (z.j->>'km')::float8) from (
      select public.olnu_sport_info(ids.bar_id, v_uid)
             || jsonb_build_object('name', bl.name, 'lat', bl.lat, 'lng', bl.lng,
                  'km', round((sqrt(power((bl.lat - p_lat) * 111.32, 2) + power((bl.lng - p_lng) * 111.32 * cos(radians(p_lat)), 2)))::numeric, 2)::float8) j
        from (select s.bar_id from public.bar_sport_votes s
               where s.bar_lat between p_lat - 0.27 and p_lat + 0.27 and s.bar_lng between p_lng - 0.27 / v_cos and p_lng + 0.27 / v_cos
              union
              select o.bar_id from public.bar_sport_owner o
               where o.bar_lat between p_lat - 0.27 and p_lat + 0.27 and o.bar_lng between p_lng - 0.27 / v_cos and p_lng + 0.27 / v_cos) ids
        join public.bars_lite bl on bl.id = ids.bar_id and bl.active
       limit 200) z), '[]'::jsonb));
end; $function$;
