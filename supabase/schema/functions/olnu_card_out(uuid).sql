-- public.olnu_card_out(p_group uuid)
-- live md5(pg_get_functiondef) = 3df128136f58c8ed1bbf4abd4d99718e
CREATE OR REPLACE FUNCTION public.olnu_card_out(p_group uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.group_members m
    join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not b.stopped and not coalesce(b.ghost, false)
   where m.group_id = p_group;
$function$;
