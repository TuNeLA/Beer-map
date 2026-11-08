-- public.olnu_photo_anon_tg()
-- live md5(pg_get_functiondef) = 254b141ba027aad31c0b417ca07e8f5f
CREATE OR REPLACE FUNCTION public.olnu_photo_anon_tg()
 RETURNS trigger
 LANGUAGE plpgsql
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
end;
$function$;
