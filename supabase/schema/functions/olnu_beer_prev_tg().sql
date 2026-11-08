-- public.olnu_beer_prev_tg()
-- live md5(pg_get_functiondef) = 54e2d8d12d243287451e93e373aff2d7
CREATE OR REPLACE FUNCTION public.olnu_beer_prev_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if coalesce(new.beer_count, 0) > coalesce(old.beer_count, 0) then
      new.prev_lat     := old.lat;
      new.prev_lng     := old.lng;
      new.prev_precise := old.precise;
      new.prev_stopped := old.stopped;
      new.prev_ghost   := old.ghost;
      new.prev_beer_at := old.beer_at;
      new.prev_for     := new.beer_count;
    end if;
    if not new.stopped then
      new.ghost := false;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
