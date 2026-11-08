-- public.olnu_g_live(p_uid uuid, p_night timestamp with time zone, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 03f77bc71c25029c830a087e210e8482
CREATE OR REPLACE FUNCTION public.olnu_g_live(p_uid uuid, p_night timestamp with time zone, p_now timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_now < p_night and (
    exists (select 1 from public.beers b
             where b.user_id = p_uid and b.expires_at = p_night and not b.stopped
               and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1))
    or exists (select 1 from public.checkins c where c.user_id = p_uid and c.expires_at = p_night));
$function$;
