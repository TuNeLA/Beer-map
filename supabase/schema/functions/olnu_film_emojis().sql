-- public.olnu_film_emojis()
-- live md5(pg_get_functiondef) = 671243bddae0ea8f8a1fa3341c840b27
CREATE OR REPLACE FUNCTION public.olnu_film_emojis()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select array['🔥', '😂', '😍', '🍻', '💀', '👑', '🫡', '🥴'];
$function$;
