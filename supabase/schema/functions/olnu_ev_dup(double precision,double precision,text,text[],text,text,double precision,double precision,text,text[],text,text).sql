-- public.olnu_ev_dup(a_lat double precision, a_lng double precision, a_bar text, a_w text[], a_h text, a_a text, b_lat double precision, b_lng double precision, b_bar text, b_w text[], b_h text, b_a text)
-- live md5(pg_get_functiondef) = 5469a4fabcf46956b7c6816cf96fff3b
CREATE OR REPLACE FUNCTION public.olnu_ev_dup(a_lat double precision, a_lng double precision, a_bar text, a_w text[], a_h text, a_a text, b_lat double precision, b_lng double precision, b_bar text, b_w text[], b_h text, b_a text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with d as (
    select sqrt(power((a_lat - b_lat) * 111320, 2) + power((a_lng - b_lng) * 111320 * cos(radians(a_lat)), 2)) as m,
           cardinality(array(select unnest(a_w) intersect select unnest(b_w))) as inter,
           greatest(cardinality(a_w), cardinality(b_w)) as mx
  )
  select coalesce(
    (d.m <= 3000 and (
        (a_h is not null and a_a is not null and b_h is not null and b_a is not null and a_h = b_h and a_a = b_a)
     or (a_h is not null and a_a is not null and (b_h is null or b_a is null) and b_w @> array[a_h, a_a])
     or (b_h is not null and b_a is not null and (a_h is null or a_a is null) and a_w @> array[b_h, b_a])))
    or ((d.m <= 300 or (a_bar is not null and a_bar = b_bar)) and d.inter >= 1 and d.mx > 0 and d.inter::float8 / d.mx >= 0.5
        and not (a_h is not null and a_a is not null and b_h is not null and b_a is not null)),
    false)
    from d;
$function$;
