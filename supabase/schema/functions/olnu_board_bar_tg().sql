-- public.olnu_board_bar_tg()
-- live md5(pg_get_functiondef) = b3064475e58dd33f0c649b5309e5709b
CREATE OR REPLACE FUNCTION public.olnu_board_bar_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.bar_id is not null and public.olnu_world_ok(new.lat, new.lng) then
      insert into public.board_bars as b (bar_id, lat, lng, updated_at)
      values (new.bar_id, new.lat, new.lng, now())
      on conflict (bar_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
