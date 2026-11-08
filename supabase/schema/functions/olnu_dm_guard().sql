-- public.olnu_dm_guard()
-- live md5(pg_get_functiondef) = 6359e0c2f9666ba81630ac5eea583c1a
CREATE OR REPLACE FUNCTION public.olnu_dm_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.dm_threads t where t.group_id = new.group_id) then
    raise exception 'group_not_found';
  end if;
  return new;
end; $function$;
