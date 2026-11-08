-- public.olnu_after_checkin_tg()
-- live md5(pg_get_functiondef) = 2d8e7437325896e023d2b52163226245
CREATE OR REPLACE FUNCTION public.olnu_after_checkin_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if tg_op = 'INSERT' or new.created_at is distinct from old.created_at then
      insert into public.after_nights as a (user_id, night, town, checkins)
      values (new.user_id, public.olnu_night_of(now()), public.olnu_town_of(new.lat, new.lng), 1)
      on conflict (user_id, night) do update
         set checkins = a.checkins + 1, town = coalesce(a.town, excluded.town);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
