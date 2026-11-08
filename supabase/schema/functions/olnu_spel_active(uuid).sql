-- public.olnu_spel_active(p_room uuid)
-- live md5(pg_get_functiondef) = c9e3395bdbd60881570db55e616a4aad
CREATE OR REPLACE FUNCTION public.olnu_spel_active(p_room uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array(select p.user_id from public.spel_players p
                         where p.room_id = p_room and p.status = 'in' and p.seen_at > now() - interval '75 seconds'
                         order by p.ord), '{}'::uuid[]);
$function$;
