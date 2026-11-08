-- public.olnu_ev_clean(p text)
-- live md5(pg_get_functiondef) = 00e41a5422bf3d79e3c7bd2afece6ec2
CREATE OR REPLACE FUNCTION public.olnu_ev_clean(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
$function$;
