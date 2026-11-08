-- public.olnu_beer_snap_tg()
-- live md5(pg_get_functiondef) = 86292543933ad87562c5c87af2bbe0ef
CREATE OR REPLACE FUNCTION public.olnu_beer_snap_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    select s.snap_lat, s.snap_lng, s.snap_bar into new.snap_lat, new.snap_lng, new.snap_bar
      from public.olnu_snap(new.lat, new.lng, new.precise) s;
  exception when others then
    new.snap_lat := (round(new.lat::numeric / 0.005) * 0.005)::float8;
    new.snap_lng := (round(new.lng::numeric / 0.01) * 0.01)::float8;
    new.snap_bar := null;
  end;
  return new;
end; $function$;
