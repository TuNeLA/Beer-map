-- public.olnu_uid()
-- live md5(pg_get_functiondef) = 2b8e523dd56dd6059b9679d181b86d18
CREATE OR REPLACE FUNCTION public.olnu_uid()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not_authenticated';
  end if;
  return v;
end;
$function$;
