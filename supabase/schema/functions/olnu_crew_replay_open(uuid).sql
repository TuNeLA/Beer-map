-- public.olnu_crew_replay_open(p_group uuid)
-- live md5(pg_get_functiondef) = 7e02473a82a17881ce4ca9054a001322
CREATE OR REPLACE FUNCTION public.olnu_crew_replay_open(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.olnu_crew_now() < public.olnu_crew_last_night(public.olnu_crew_now()) + interval '13 hours'
     and exists (select 1 from public.crew_tracks t join public.group_members m on m.user_id = t.user_id
                  where m.group_id = p_group and t.night = public.olnu_crew_last_night(public.olnu_crew_now()));
$function$;
