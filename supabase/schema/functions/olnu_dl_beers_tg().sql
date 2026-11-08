-- public.olnu_dl_beers_tg()
-- live md5(pg_get_functiondef) = e191f96b79da0441c50342813cb3eb96
CREATE OR REPLACE FUNCTION public.olnu_dl_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ob int := 0; v_oo int := 0; v_db int; v_do int;
  v_same boolean := true;
  v_lat float8 := new.lat; v_lng float8 := new.lng;
  v_wp text := coalesce(current_setting('olnu.world_pos', true), '');
  v_ghost boolean := coalesce(current_setting('olnu.ghost', true), '') = '1' or coalesce(new.ghost, false);
  v_night timestamptz := coalesce(new.expires_at, public.olnu_night_of(now()));
  v_bar text; v_name text; v_area text; i int;
begin
  begin
    if tg_op = 'UPDATE' then
      v_same := old.expires_at is not distinct from new.expires_at;
      if v_same then v_ob := coalesce(old.beer_count, 0); v_oo := coalesce(old.other_count, 0); end if;
    end if;
    v_db := coalesce(new.beer_count, 0) - v_ob;
    v_do := coalesce(new.other_count, 0) - v_oo;
    if v_wp ~ '^-?[0-9.]+,-?[0-9.]+$' then
      v_lat := split_part(v_wp, ',', 1)::float8; v_lng := split_part(v_wp, ',', 2)::float8;
    end if;
    if v_db > 0 or v_do > 0 then
      v_bar := case when v_wp = '' then new.snap_bar end;
      v_name := case when v_bar is not null then public.olnu_dl_bar_name(v_bar) end;
      begin v_area := left(public.olnu_town_of(v_lat, v_lng), 40); exception when others then v_area := null; end;
    end if;
    for i in 1 .. least(greatest(v_db, 0), 5) loop
      insert into public.drink_log (user_id, night, kind, lat, lng, bar_id, bar_name, area, ghost)
      values (new.user_id, v_night, 'beer', round(v_lat::numeric, 3), round(v_lng::numeric, 3), v_bar, v_name, v_area, v_ghost);
    end loop;
    for i in 1 .. least(greatest(v_do, 0), 5) loop
      insert into public.drink_log (user_id, night, kind, lat, lng, bar_id, bar_name, area, ghost)
      values (new.user_id, v_night,
              case when new.other_kind in ('cider', 'drink', 'shot', 'vin', 'rom', 'whisky', 'grogg', 'bubbel') then new.other_kind else 'annat' end,
              round(v_lat::numeric, 3), round(v_lng::numeric, 3), v_bar, v_name, v_area, v_ghost);
    end loop;
    if tg_op = 'UPDATE' and v_same and v_db < 0 then
      update public.drink_log d set undone = true
       where d.id in (select x.id from public.drink_log x
                       where x.user_id = new.user_id and x.night = v_night and x.kind = 'beer' and not x.undone
                       order by x.at desc, x.id desc limit least(-v_db, 5));
    end if;
    if tg_op = 'UPDATE' and v_same and v_do = 0 and new.other_kind is distinct from old.other_kind
       and new.other_kind in ('cider', 'drink', 'shot', 'vin', 'rom', 'whisky', 'grogg', 'bubbel', 'annat') then
      update public.drink_log d set kind = new.other_kind
       where d.id = (select x.id from public.drink_log x
                      where x.user_id = new.user_id and x.night = v_night and x.kind not in ('beer', 'checkin')
                        and x.at > now() - interval '2 minutes' and not x.undone
                      order by x.at desc, x.id desc limit 1);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
