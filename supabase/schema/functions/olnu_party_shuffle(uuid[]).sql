-- public.olnu_party_shuffle(p uuid[])
-- live md5(pg_get_functiondef) = 523e999969a79d89c681457dd6797db6
CREATE OR REPLACE FUNCTION public.olnu_party_shuffle(p uuid[])
 RETURNS uuid[]
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select coalesce(array(select x from unnest(p) x order by random()), '{}'::uuid[]);
$function$;
