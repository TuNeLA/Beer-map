-- public.olnu_medal_checkin_tg()
-- live md5(pg_get_functiondef) = d71ddc209cb3c3de04480cf756c50787
CREATE OR REPLACE FUNCTION public.olnu_medal_checkin_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    insert into public.medal_checkins (user_id, bar_id, night)
    values (new.user_id, left(new.bar_id, 80), public.olnu_night_of(now()))
    on conflict do nothing;
  exception when others then
    null;
  end;
  return new;
end; $function$;
