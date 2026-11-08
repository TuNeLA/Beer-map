-- public.olnu_duel_skal_tg()
-- live md5(pg_get_functiondef) = 5a6d02f94e92058b2f1fab8290940342
CREATE OR REPLACE FUNCTION public.olnu_duel_skal_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if exists (select 1 from public.group_members m where m.user_id = new.user_id) then
      insert into public.duel_log (user_id, kind, n) values (new.user_id, 'skal', 1);
    end if;
  exception when others then null;
  end;
  return new;
end; $function$;
