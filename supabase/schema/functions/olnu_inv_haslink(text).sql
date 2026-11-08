-- public.olnu_inv_haslink(p text)
-- live md5(pg_get_functiondef) = 935a0dac88fc299d6140adc12bd86906
CREATE OR REPLACE FUNCTION public.olnu_inv_haslink(p text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(p, '') ~* '(https?://|www\.|\.(se|com|nu|net|org)(/|\s|$))';
$function$;
