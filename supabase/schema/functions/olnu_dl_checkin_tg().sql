-- public.olnu_dl_checkin_tg()
-- live md5(pg_get_functiondef) = bafb3fc023fc5e73787a04feb2320bf6
CREATE OR REPLACE FUNCTION public.olnu_dl_checkin_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_area text;
begin
  begin
    if tg_op = 'INSERT' or new.bar_id is distinct from old.bar_id or new.created_at is distinct from old.created_at then
      if new.expires_at > now() and new.lat <> 0 then
        begin v_area := left(public.olnu_town_of(new.lat, new.lng), 40); exception when others then v_area := null; end;
        insert into public.drink_log (user_id, night, kind, lat, lng, bar_id, bar_name, area)
        values (new.user_id, public.olnu_night_of(now()), 'checkin', round(new.lat::numeric, 3), round(new.lng::numeric, 3),
                left(new.bar_id, 80), left(new.bar_name, 60), v_area);
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
