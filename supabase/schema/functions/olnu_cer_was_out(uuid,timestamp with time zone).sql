-- public.olnu_cer_was_out(p_uid uuid, p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = b930e86831cc4aab7ad9959acfa7d28a
CREATE OR REPLACE FUNCTION public.olnu_cer_was_out(p_uid uuid, p_night timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.medal_nights mn where mn.user_id = p_uid and mn.night = p_night and mn.beers + mn.others > 0)
      or exists (select 1 from public.medal_checkins mc where mc.user_id = p_uid and mc.night = p_night)
      or exists (select 1 from public.after_nights an where an.user_id = p_uid and an.night = p_night and (an.out or an.checkins > 0));
$function$;
