-- public.olnu_is_test_user(p_uid uuid)
-- live md5(pg_get_functiondef) = 154864d4efe243202c217670dd2c2440
CREATE OR REPLACE FUNCTION public.olnu_is_test_user(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null and coalesce(
    (select public.olnu_is_test_zone(b.lat, b.lng) from public.beers b where b.user_id = p_uid limit 1),
    (select public.olnu_is_test_zone(c.lat, c.lng) from public.checkins c where c.user_id = p_uid limit 1),
    (select bool_or(public.olnu_is_test_zone(s.lat, s.lng)) from public.push_subscriptions s
      where s.user_id = p_uid and s.lat is not null),
    false);
$function$;
