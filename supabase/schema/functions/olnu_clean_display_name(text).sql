-- public.olnu_clean_display_name(p text)
-- live md5(pg_get_functiondef) = 7a26fb4193f837ddc69a16bc748a65a0
CREATE OR REPLACE FUNCTION public.olnu_clean_display_name(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v text := btrim(coalesce(p, ''));
begin
  if char_length(v) < 1 or char_length(v) > 30 then
    raise exception 'invalid_name';
  end if;
  return v;
end;
$function$;
