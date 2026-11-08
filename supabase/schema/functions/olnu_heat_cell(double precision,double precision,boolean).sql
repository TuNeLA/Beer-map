-- public.olnu_heat_cell(p_lat double precision, p_lng double precision, p_precise boolean)
-- live md5(pg_get_functiondef) = f08bb8815f721837a257ede525f0e096
CREATE OR REPLACE FUNCTION public.olnu_heat_cell(p_lat double precision, p_lng double precision, p_precise boolean)
 RETURNS TABLE(hlat double precision, hlng double precision, hkind smallint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_la float8; v_ln float8;
begin
  if p_lat is null or p_lng is null or not coalesce(p_precise, false) then
    return query select p_lat, p_lng, 3::smallint;
    return;
  end if;
  select nb.lat, nb.lng into v_la, v_ln from public.olnu_near_bar(p_lat, p_lng) nb;
  if v_la is not null then
    return query select v_la, v_ln, 1::smallint;
    return;
  end if;
  return query select (round(p_lat::numeric / 0.0005) * 0.0005)::float8, (round(p_lng::numeric / 0.001) * 0.001)::float8, 2::smallint;
end;
$function$;
