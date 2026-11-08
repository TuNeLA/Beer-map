-- public.heat_points()
-- live md5(pg_get_functiondef) = b10242d8135e225c4f72756f521b4a5d
CREATE OR REPLACE FUNCTION public.heat_points()
 RETURNS TABLE(lat double precision, lng double precision, w double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.olnu_uid();
  return query select h.lat, h.lng, h.w from public.olnu_heat(null, null, null, null, 5000) h;
end; $function$;
