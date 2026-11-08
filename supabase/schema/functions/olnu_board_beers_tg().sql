-- public.olnu_board_beers_tg()
-- live md5(pg_get_functiondef) = 070d301162cda5e112b3c0e50b829ef5
CREATE OR REPLACE FUNCTION public.olnu_board_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new int := coalesce(new.beer_count, 0) + coalesce(new.other_count, 0);
  v_old int := 0;
  v_oo  int := 0;
begin
  begin
    if tg_op = 'UPDATE' then
      v_old := coalesce(old.beer_count, 0) + coalesce(old.other_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if v_new <> v_old and (v_new > 0 or tg_op = 'UPDATE') then
      insert into public.board_nights as n (user_id, night, drinks, lat, lng, updated_at)
      values (new.user_id, new.expires_at, v_new,
              (round(new.lat::numeric / 0.05) * 0.05)::float8, (round(new.lng::numeric / 0.1) * 0.1)::float8, now())
      on conflict (user_id, night) do update
         set drinks = excluded.drinks,
             lat = case when excluded.drinks > n.drinks or n.lat is null then excluded.lat else n.lat end,
             lng = case when excluded.drinks > n.drinks or n.lng is null then excluded.lng else n.lng end,
             updated_at = now();
    end if;
    if coalesce(new.other_count, 0) > v_oo then
      insert into public.owner_hours as h (hour, beers) values (date_trunc('hour', now()), coalesce(new.other_count, 0) - v_oo)
      on conflict (hour) do update set beers = h.beers + excluded.beers;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
