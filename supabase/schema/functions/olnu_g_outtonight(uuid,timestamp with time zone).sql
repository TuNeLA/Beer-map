-- public.olnu_g_outtonight(p_uid uuid, p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = 03987622478374f01f5944c5addc795b
CREATE OR REPLACE FUNCTION public.olnu_g_outtonight(p_uid uuid, p_night timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.medal_nights mn
                  where mn.user_id = p_uid and mn.night = p_night and (mn.beers >= 1 or mn.others >= 1))
      or exists (select 1 from public.beers b
                  where b.user_id = p_uid and b.expires_at = p_night and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1))
      or exists (select 1 from public.checkins c where c.user_id = p_uid and c.expires_at = p_night)
      or exists (select 1 from public.medal_checkins m where m.user_id = p_uid and m.night = p_night);
$function$;
