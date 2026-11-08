-- public.olnu_uname_anon_tg()
-- live md5(pg_get_functiondef) = 2a6bb9ef895017899e5120fd91ddf814
CREATE OR REPLACE FUNCTION public.olnu_uname_anon_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.user_id is distinct from old.user_id then new.name := null; end if;
  exception when others then null;
  end;
  return new;
end; $function$;
