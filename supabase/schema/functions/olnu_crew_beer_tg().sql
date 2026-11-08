-- public.olnu_crew_beer_tg()
-- live md5(pg_get_functiondef) = 8f4e2b4b5ea61cd9b8d5df651d4c3e30
CREATE OR REPLACE FUNCTION public.olnu_crew_beer_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.beers;
  v_name text;
begin
  begin
    if tg_op = 'INSERT'
       or coalesce(new.beer_count, 0) > coalesce(old.beer_count, 0)
       or coalesce(new.other_count, 0) > coalesce(old.other_count, 0) then
      select * into b from public.beers x where x.id = new.id;
      if found and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
         and b.snap_lat is not null and b.snap_lng is not null
         and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)) >= 1 then
        if b.snap_bar is not null then
          select bl.name into v_name from public.bars_lite bl where bl.id = b.snap_bar;
        end if;
        perform public.olnu_crew_track_add(b.user_id, 'drink', b.snap_bar, v_name, b.snap_lat, b.snap_lng);
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
