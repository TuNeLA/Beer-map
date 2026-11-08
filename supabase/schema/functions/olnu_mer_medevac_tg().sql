-- public.olnu_mer_medevac_tg()
-- live md5(pg_get_functiondef) = d1aaef2a1c60bcb3280479f09381c71d
CREATE OR REPLACE FUNCTION public.olnu_mer_medevac_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.olnu_mer_add(new.checker, new.night, 'buddy', new.target::text, 5, 10);
  exception when others then
    null;
  end;
  return null;
end; $function$;
