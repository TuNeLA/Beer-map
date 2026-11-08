-- public.olnu_mer_inv_ci_tg()
-- live md5(pg_get_functiondef) = 913f13e01579200b965c61c60cbd5129
CREATE OR REPLACE FUNCTION public.olnu_mer_inv_ci_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if tg_op = 'UPDATE' and old.created_at = new.created_at and old.bar_id = new.bar_id then return null; end if;
    if new.expires_at <= now() or (new.lat = 0 and new.lng = 0) then return null; end if;
    perform public.olnu_inv_show(new.user_id, new.expires_at, new.lat, new.lng, new.bar_id);
  exception when others then null;
  end;
  return null;
end; $function$;
