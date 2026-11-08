-- public.olnu_push_cats()
-- live md5(pg_get_functiondef) = 3b69960a5168a6deb3064389adbb0078
CREATE OR REPLACE FUNCTION public.olnu_push_cats()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select array['ute','chat','dm','plan','kaos','bar','kul','vanner','film']::text[]
$function$;
