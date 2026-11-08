-- public.olnu_crew_my_town(p_uid uuid, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = d71289948e6f51ff62f78a00bb3cda18
CREATE OR REPLACE FUNCTION public.olnu_crew_my_town(p_uid uuid, p_lat double precision, p_lng double precision)
 RETURNS TABLE(key text, name text, lat double precision, lng double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p record;
begin
  select * into p from public.olnu_crew_pres(p_uid);
  if p.lat is not null then
    return query select * from public.olnu_crew_town(p.lat, p.lng);
    return;
  end if;
  if public.olnu_world_ok(p_lat, p_lng) then
    return query select * from public.olnu_crew_town(p_lat, p_lng);
  end if;
end; $function$;
