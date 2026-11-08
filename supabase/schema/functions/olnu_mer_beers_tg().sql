-- public.olnu_mer_beers_tg()
-- live md5(pg_get_functiondef) = 76948c07173d0b32f68bf788d18f6dd1
CREATE OR REPLACE FUNCTION public.olnu_mer_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old int := 0;
  v_new int;
  i     int;
begin
  begin
    v_new := new.beer_count + coalesce(new.other_count, 0);
    if tg_op = 'UPDATE' and old.expires_at = new.expires_at then
      v_old := old.beer_count + coalesce(old.other_count, 0);
    end if;
    if v_new > v_old and new.expires_at > now() then
      for i in (v_old + 1)..(case when public.olnu_store_on() then v_old else least(v_new, v_old + 20) end) loop   -- 0211: 0 per drink in store mode
        perform public.olnu_mer_add(new.user_id, new.expires_at, 'drink', 'd' || i::text, 1, null);
      end loop;
      if not coalesce(new.ghost, false) and not coalesce(new.stopped, false) then
        perform public.olnu_mer_squad(new.user_id, new.expires_at, new.lat, new.lng);
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
