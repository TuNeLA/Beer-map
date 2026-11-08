-- public.olnu_g_real(p_night timestamp with time zone, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 0587b5d9482621651b62f5b0ce71148f
CREATE OR REPLACE FUNCTION public.olnu_g_real(p_night timestamp with time zone, p_lat double precision, p_lng double precision)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct d.user_id)::int from public.drink_log d
   where d.night = p_night and not d.undone
     and d.lat between p_lat - 0.19 and p_lat + 0.19
     and d.lng between p_lng - 0.56 and p_lng + 0.56
     and public.olnu_dist_m(p_lat, p_lng, d.lat, d.lng) <= 20000
     and not public.olnu_is_test_user(d.user_id);
$function$;
