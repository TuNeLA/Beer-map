-- public.olnu_kommun_of(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 82bd02ce82844a3e92ac50452a8fcb37
CREATE OR REPLACE FUNCTION public.olnu_kommun_of(p_lat double precision, p_lng double precision)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- inside a border; else (SCB's simplified coast: ~7 % of Swedish bars sit just outside, harbours, islands) the nearest
  -- kommun within ~3 km; else null (sea, abroad)
  select coalesce(
    (select z.kn from public.olnu_zone_poly z
      where p_lat is not null and p_lng is not null
        and z.bb @> point(p_lng, p_lat) and z.poly @> point(p_lng, p_lat)
      order by area(z.bb), z.kn
      limit 1),
    (select z.kn from public.olnu_zone_poly z
      where p_lat is not null and p_lng is not null
        and z.bb && box(point(p_lng - 0.06, p_lat - 0.03), point(p_lng + 0.06, p_lat + 0.03))
        and (z.poly <-> point(p_lng, p_lat)) < 0.03
      order by z.poly <-> point(p_lng, p_lat), z.kn
      limit 1));
$function$;
