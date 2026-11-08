-- public.olnu_clean_town(p text)
-- live md5(pg_get_functiondef) = 85f64b4aea955aa3640569aa231b84d5
CREATE OR REPLACE FUNCTION public.olnu_clean_town(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v text := btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
begin
  if v = '' then return ''; end if;
  if char_length(v) > 30 then return null; end if;
  if v !~ '^[[:alpha:][:digit:] .,''’()&/-]+$' then return null; end if;
  if v !~ '[[:alpha:]]' then return null; end if;
  return v;
end; $function$;
