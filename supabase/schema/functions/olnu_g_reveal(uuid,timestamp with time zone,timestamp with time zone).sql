-- public.olnu_g_reveal(p_group uuid, p_night timestamp with time zone, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 671ce14ce36b6c939521e4c419facf58
CREATE OR REPLACE FUNCTION public.olnu_g_reveal(p_group uuid, p_night timestamp with time zone, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.game_agents a
     set revealed_at = p_now,
         correct = (select count(*) from public.game_agent_votes v
                     where v.group_id = a.group_id and v.night = a.night and v.suspect = a.agent),
         votes = (select count(*) from public.game_agent_votes v where v.group_id = a.group_id and v.night = a.night)
   where a.group_id = p_group and a.night = p_night and a.revealed_at is null and p_now >= p_night
     and (p_now >= ((p_night at time zone 'Europe/Stockholm') + interval '7 hours') at time zone 'Europe/Stockholm'
          or (select count(*) from public.game_agent_votes v where v.group_id = a.group_id and v.night = a.night)
             >= (select count(*) from public.group_members m where m.group_id = p_group and m.user_id <> a.agent));
end;
$function$;
