-- public.olnu_dm_expiry()
-- live md5(pg_get_functiondef) = a0caa200c7bddd52dd9eb5889c3161b5
CREATE OR REPLACE FUNCTION public.olnu_dm_expiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.dm_threads t where t.group_id = new.group_id) then
    new.expires_at := now() + interval '7 days';
  end if;
  return new;
end; $function$;
