-- public.olnu_duel_photo_tg()
-- live md5(pg_get_functiondef) = 052dba04e4eac12567d2d278fe3ba8e9
CREATE OR REPLACE FUNCTION public.olnu_duel_photo_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if public.olnu_dm_is(new.group_id) then return new; end if;
    insert into public.duel_log (user_id, kind, n) values (new.user_id, 'photo', 1);
  exception when others then null;
  end;
  return new;
end; $function$;
