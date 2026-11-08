-- public.olnu_eta_beer_tg()
-- live md5(pg_get_functiondef) = de3ccbe125af3e6a486e1084cf8df8e4
CREATE OR REPLACE FUNCTION public.olnu_eta_beer_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if (tg_op = 'INSERT'
        or coalesce(new.beer_count, 0) > coalesce(old.beer_count, 0)
        or coalesce(new.other_count, 0) > coalesce(old.other_count, 0))
       and coalesce(new.precise, false) and not coalesce(new.stopped, false) and not coalesce(new.ghost, false) then
      perform public.olnu_eta_arrive(new.user_id, new.snap_bar, new.lat, new.lng, false);
    end if;
  exception when others then
    null;   -- an ETA bug never blocks a beer
  end;
  return new;
end; $function$;
