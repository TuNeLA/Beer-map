-- public.olnu_after_beers_tg()
-- live md5(pg_get_functiondef) = 21cd66a40cc6d2540efa871e41be5965
CREATE OR REPLACE FUNCTION public.olnu_after_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ob int := 0;
  v_oo int := 0;
begin
  begin
    if tg_op = 'UPDATE' then
      v_ob := coalesce(old.beer_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if coalesce(new.beer_count, 0) > v_ob or coalesce(new.other_count, 0) > v_oo then
      insert into public.after_nights as a (user_id, night, town, out)
      values (new.user_id, new.expires_at, public.olnu_town_of(new.lat, new.lng), true)
      on conflict (user_id, night) do update
         set out = true, town = coalesce(a.town, excluded.town);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
