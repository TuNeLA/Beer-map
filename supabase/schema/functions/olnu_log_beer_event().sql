-- public.olnu_log_beer_event()
-- live md5(pg_get_functiondef) = da8cfbebaa3b1ec124fcd1e396d1c89a
CREATE OR REPLACE FUNCTION public.olnu_log_beer_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old_beers int := 0;
  v_old_shots int := 0;
begin
  if coalesce(current_setting('olnu.ghost', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old_beers := coalesce(old.beer_count, 0);
    v_old_shots := coalesce(old.shot_count, 0);
  end if;
  if coalesce(new.beer_count, 0) > v_old_beers then
    insert into public.beer_events (kind, lat, lng, precise, n, expires_at)
    values ('beer', new.lat, new.lng, coalesce(new.precise, false), new.beer_count, new.expires_at);
  end if;
  if coalesce(new.shot_count, 0) > v_old_shots then
    insert into public.beer_events (kind, lat, lng, precise, n, expires_at)
    values ('shot', new.lat, new.lng, coalesce(new.precise, false), 0, new.expires_at);
  end if;
  return new;
end; $function$;
