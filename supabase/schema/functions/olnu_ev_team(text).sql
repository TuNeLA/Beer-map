-- public.olnu_ev_team(p text)
-- live md5(pg_get_functiondef) = 771254ab885a42bd3901122d21dfc88b
CREATE OR REPLACE FUNCTION public.olnu_ev_team(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select w from unnest(public.olnu_ev_words(p)) with ordinality as x(w, n) where length(w) >= 3 order by n limit 1;
$function$;
