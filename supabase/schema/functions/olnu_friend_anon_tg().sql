-- public.olnu_friend_anon_tg()
-- live md5(pg_get_functiondef) = 3dbbf1c830cb9f5024787df2d7a9e872
CREATE OR REPLACE FUNCTION public.olnu_friend_anon_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.a is distinct from old.a or new.b is distinct from old.b then
      if new.status in ('pending', 'accepted') then
        new.status := 'removed'; new.updated_at := now();
      end if;
    end if;
  exception when others then null;
  end;
  return new;
end; $function$;
