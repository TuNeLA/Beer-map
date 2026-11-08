-- public.olnu_medal_beers_tg()
-- live md5(pg_get_functiondef) = d51eb719e17def772bc66d3eaa94b43b
CREATE OR REPLACE FUNCTION public.olnu_medal_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ob int := 0;
  v_oo int := 0;
  v_h  int := extract(hour from (now() at time zone 'Europe/Stockholm'))::int;
begin
  begin
    if tg_op = 'UPDATE' then
      v_ob := coalesce(old.beer_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if coalesce(new.beer_count, 0) > v_ob then
      insert into public.medal_nights as m (user_id, night, beers, first_at, early, owl, cell)
      values (new.user_id, new.expires_at, new.beer_count, now(),
              v_h >= 5 and v_h < 16, v_h >= 1 and v_h < 5, public.olnu_cell(new.lat, new.lng))
      on conflict (user_id, night) do update
         set beers = greatest(m.beers, excluded.beers),
             first_at = coalesce(m.first_at, excluded.first_at),
             early = m.early or excluded.early,
             owl = m.owl or excluded.owl,
             cell = coalesce(m.cell, excluded.cell);
    end if;
    if coalesce(new.other_count, 0) > v_oo then
      insert into public.medal_nights as m (user_id, night, others, first_at, early, owl, cell)
      values (new.user_id, new.expires_at, new.other_count, now(),
              v_h >= 5 and v_h < 16, v_h >= 1 and v_h < 5, public.olnu_cell(new.lat, new.lng))
      on conflict (user_id, night) do update
         set others = greatest(m.others, excluded.others),
             first_at = coalesce(m.first_at, excluded.first_at),
             early = m.early or excluded.early,
             owl = m.owl or excluded.owl,
             cell = coalesce(m.cell, excluded.cell);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
