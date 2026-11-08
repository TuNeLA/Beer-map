-- public.olnu_gw_name_for(p_who uuid, p_viewer uuid)
-- live md5(pg_get_functiondef) = ad0e99f026af3c857beab543d22cdd18
CREATE OR REPLACE FUNCTION public.olnu_gw_name_for(p_who uuid, p_viewer uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select m.display_name from public.group_members m join public.group_members v on v.group_id = m.group_id
      where m.user_id = p_who and v.user_id = p_viewer and nullif(btrim(m.display_name), '') is not null
      order by m.joined_at limit 1),
    nullif(btrim(public.olnu_friend_name(p_who)), ''), 'En kompis');
$function$;
