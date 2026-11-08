-- public.olnu_duel_checkin_tg()
-- live md5(pg_get_functiondef) = 62ede7573be60e643e06242d8108b505
CREATE OR REPLACE FUNCTION public.olnu_duel_checkin_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if (tg_op = 'INSERT' or new.created_at is distinct from old.created_at)
       and exists (select 1 from public.group_members m where m.user_id = new.user_id) then
      insert into public.duel_log (user_id, kind, n) values (new.user_id, 'checkin', 1);
    end if;
  exception when others then null;
  end;
  return new;
end; $function$;
