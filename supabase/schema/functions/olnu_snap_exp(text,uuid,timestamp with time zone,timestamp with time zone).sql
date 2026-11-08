-- public.olnu_snap_exp(p_kind text, p_group uuid, p_night timestamp with time zone, p_reveal timestamp with time zone)
-- live md5(pg_get_functiondef) = 3136dad85c8b2b5ed9deb3a1a8544bd1
CREATE OR REPLACE FUNCTION public.olnu_snap_exp(p_kind text, p_group uuid, p_night timestamp with time zone, p_reveal timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p_kind = 'film'
              then coalesce(p_reveal, public.olnu_gang_reveal(p_night))
                   + case when public.olnu_group_keeps(p_group) then interval '30 days' else interval '7 days' end
              else (((p_night at time zone 'Europe/Stockholm')::date + time '12:00') at time zone 'Europe/Stockholm')
                   + case when public.olnu_group_keeps(p_group) then interval '30 days' else interval '0 days' end
         end;
$function$;
