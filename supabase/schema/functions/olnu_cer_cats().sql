-- public.olnu_cer_cats()
-- live md5(pg_get_functiondef) = f827e45ac4eb5a4b80f3e220e467814b
CREATE OR REPLACE FUNCTION public.olnu_cer_cats()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select array['hjalte', 'clown', 'citat', 'ankaret', 'dansgolv', 'filosof', 'kebab', 'stil', 'comeback']::text[];
$function$;
