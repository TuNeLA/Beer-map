-- public.olnu_rnd_swish_norm(p text)
-- live md5(pg_get_functiondef) = 7e9bc1798e6b7f954d469123bb934499
CREATE OR REPLACE FUNCTION public.olnu_rnd_swish_norm(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v text := regexp_replace(coalesce(p, ''), '[\s\-().]', '', 'g');
begin
  if v like '+46%' then v := '0' || substr(v, 4); elsif v like '0046%' then v := '0' || substr(v, 5); end if;
  if v = '' then return ''; end if;
  if v !~ '^07[0-9]{8}$' then return null; end if;
  return v;
end; $function$;
