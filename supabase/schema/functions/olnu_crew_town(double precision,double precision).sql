-- public.olnu_crew_town(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 7fd72f771a973573172c9f1d964bfeec
CREATE OR REPLACE FUNCTION public.olnu_crew_town(p_lat double precision, p_lng double precision)
 RETURNS TABLE(key text, name text, lat double precision, lng double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
begin
  if p_lat is null or p_lng is null then return; end if;
  v_name := public.olnu_town_of(p_lat, p_lng);
  if v_name is not null then
    return query select 't:' || t.name, t.name, t.lat, t.lng from public.olnu_towns t where t.name = v_name limit 1;
    return;
  end if;
  return query select 'z:' || (round(p_lat::numeric * 2) / 2)::numeric(6, 1)::text || ':' || round(p_lng::numeric)::int::text,
                      null::text, ((round(p_lat::numeric * 2) / 2))::float8, (round(p_lng::numeric))::float8;
end; $function$;
