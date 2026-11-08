-- public.olnu_are_friends(p_x uuid, p_y uuid)
-- live md5(pg_get_functiondef) = 7cf798418eba727ca44089a5ed2e1d87
CREATE OR REPLACE FUNCTION public.olnu_are_friends(p_x uuid, p_y uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.friendships f
                  where least(f.a, f.b) = least(p_x, p_y) and greatest(f.a, f.b) = greatest(p_x, p_y)
                    and f.status = 'accepted');
$function$;
