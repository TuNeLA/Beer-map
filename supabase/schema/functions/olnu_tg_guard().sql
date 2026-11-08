-- public.olnu_tg_guard()
-- live md5(pg_get_functiondef) = 3baedcc6586b116d81ab7501ce027acd
CREATE OR REPLACE FUNCTION public.olnu_tg_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.temp_groups t where t.group_id = new.group_id) then
    raise exception 'group_not_found';
  end if;
  return new;
end; $function$;
