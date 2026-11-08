-- public.olnu_near_bar(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 62a41a82f5fcdf15d75fe4d99474a9d7
CREATE OR REPLACE FUNCTION public.olnu_near_bar(p_lat double precision, p_lng double precision)
 RETURNS TABLE(id text, lat double precision, lng double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select bl.id, bl.lat, bl.lng
    from public.bars_lite bl
   where bl.active
     and bl.lat between p_lat - 0.001 and p_lat + 0.001
     and bl.lng between p_lng - 0.0027 and p_lng + 0.0027
     and power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2)
         <= case when coalesce(bl.type, '') in ('restaurant', 'fast_food', 'cafe') then 1600
                 when bl.type = 'arena' then 12100 else 5625 end
   order by (coalesce(bl.type, '') in ('restaurant', 'fast_food', 'cafe')),
            power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2), bl.id
   limit 1;
$function$;
