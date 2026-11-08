-- public.olnu_area_bar_pos(p_bar_id text)
-- live md5(pg_get_functiondef) = 8f101c3ddeb3836b7b552c91ba84b58f
CREATE OR REPLACE FUNCTION public.olnu_area_bar_pos(p_bar_id text)
 RETURNS double precision[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v double precision[]; m text[];
begin
  select array[b.lat, b.lng] into v from public.bars_lite b where b.id = p_bar_id and b.active;
  if v is not null then return v; end if;
  m := regexp_match(coalesce(p_bar_id, ''), '^pl_(-?\d{1,8})_(-?\d{1,8})$');
  if m is not null then
    v := array[m[1]::double precision / 1e5, m[2]::double precision / 1e5];
    if abs(v[1]) <= 85 and abs(v[2]) <= 180 then return v; end if;
  end if;
  return null;
end; $function$;
