-- public.olnu_mask_text(p text)
-- live md5(pg_get_functiondef) = 978c0373d5bc5b9899648b20bfa4dbde
CREATE OR REPLACE FUNCTION public.olnu_mask_text(p text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v text := p; r record; m text; i int;
begin
  if v is null or v = '' then return v; end if;
  for r in select b.pattern from public.ugc_badwords b where b.active loop
    i := 0;
    loop
      i := i + 1;
      exit when i > 20;
      m := substring(v from '(?i)(' || r.pattern || ')');
      exit when m is null or m = '' or m !~ '[^*]{2}';
      v := regexp_replace(v, '(?i)' || r.pattern, left(m, 1) || repeat('*', greatest(char_length(m) - 1, 1)));
    end loop;
  end loop;
  return v;
end; $function$;
