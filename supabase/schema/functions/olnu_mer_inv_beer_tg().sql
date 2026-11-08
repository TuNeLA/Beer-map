-- public.olnu_mer_inv_beer_tg()
-- live md5(pg_get_functiondef) = c47f7ea510b8e6c925331d349241b596
CREATE OR REPLACE FUNCTION public.olnu_mer_inv_beer_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old int := 0; v_new int;
begin
  begin
    v_new := new.beer_count + coalesce(new.other_count, 0);
    if tg_op = 'UPDATE' and old.expires_at = new.expires_at then v_old := old.beer_count + coalesce(old.other_count, 0); end if;
    if v_new > v_old and new.expires_at > now() and new.precise and not coalesce(new.ghost, false) and not coalesce(new.stopped, false) then
      perform public.olnu_inv_show(new.user_id, new.expires_at, new.lat, new.lng, new.snap_bar);
    end if;
  exception when others then null;
  end;
  return null;
end; $function$;
