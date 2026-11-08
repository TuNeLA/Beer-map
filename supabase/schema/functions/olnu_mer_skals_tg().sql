-- public.olnu_mer_skals_tg()
-- live md5(pg_get_functiondef) = 891c51372005a037bd78b06d98a35a2d
CREATE OR REPLACE FUNCTION public.olnu_mer_skals_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b record;
begin
  begin
    select x.user_id, x.expires_at into b from public.beers x where x.id = new.beer_id;
    if found and b.user_id <> new.user_id then
      perform public.olnu_mer_add(new.user_id, b.expires_at, 'skal_give', 'b:' || new.beer_id::text, 1, 10);
      perform public.olnu_mer_add(b.user_id, b.expires_at, 'skal_get', 'u:' || new.user_id::text || ':' || new.beer_id::text, 1, 10);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
