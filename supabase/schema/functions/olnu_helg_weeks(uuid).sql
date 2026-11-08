-- public.olnu_helg_weeks(p_uid uuid)
-- live md5(pg_get_functiondef) = 1e6f401833155307f1f98febdd2521fc
CREATE OR REPLACE FUNCTION public.olnu_helg_weeks(p_uid uuid)
 RETURNS TABLE(week date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct date_trunc('week', x.ev::timestamp)::date
    from (select public.olnu_evening(mn.night) as ev from public.medal_nights mn
           where mn.user_id = p_uid and mn.beers + mn.others > 0
          union
          select public.olnu_evening(mc.night) from public.medal_checkins mc where mc.user_id = p_uid
          union
          select public.olnu_evening(an.night) from public.after_nights an
           where an.user_id = p_uid and (an.out or an.checkins > 0)) x
   where extract(isodow from x.ev) in (5, 6, 7);
$function$;
