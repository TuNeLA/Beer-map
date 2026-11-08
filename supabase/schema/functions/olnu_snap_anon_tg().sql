-- public.olnu_snap_anon_tg()
-- live md5(pg_get_functiondef) = 1a03f2a0f9768e5c9b9fd658bd38c93e
CREATE OR REPLACE FUNCTION public.olnu_snap_anon_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.user_id is distinct from old.user_id then
      new.bytes := null;
      new.size := 0;
      new.expires_at := least(new.expires_at, now());
    end if;
  exception when others then null;
  end;
  return new;
end; $function$;
