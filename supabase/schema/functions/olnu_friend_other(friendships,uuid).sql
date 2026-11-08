-- public.olnu_friend_other(f friendships, p_uid uuid)
-- live md5(pg_get_functiondef) = 40ec30ec87cd75a0d25f05f27b9995b1
CREATE OR REPLACE FUNCTION public.olnu_friend_other(f friendships, p_uid uuid)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when f.a = p_uid then f.b else f.a end;
$function$;
