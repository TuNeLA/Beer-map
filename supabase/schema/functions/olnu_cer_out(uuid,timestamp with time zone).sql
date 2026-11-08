-- public.olnu_cer_out(p_gid uuid, p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = 59ee884cdd09c6ebeff2d8fee71c3db2
CREATE OR REPLACE FUNCTION public.olnu_cer_out(p_gid uuid, p_night timestamp with time zone)
 RETURNS TABLE(user_id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select gm.user_id, gm.display_name from public.group_members gm
   where gm.group_id = p_gid and public.olnu_cer_was_out(gm.user_id, p_night)
   order by gm.joined_at, gm.user_id;
$function$;
