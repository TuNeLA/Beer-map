-- public.owner_find_bars(p_key text, p_q text)
-- live md5(pg_get_functiondef) = fac25817a7d4f03b03dabdaeeb26a3b7
CREATE OR REPLACE FUNCTION public.owner_find_bars(p_key text, p_q text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_q text := btrim(coalesce(p_q, ''));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if char_length(v_q) < 2 or char_length(v_q) > 40 then return jsonb_build_object('bars', '[]'::jsonb); end if;
  return jsonb_build_object('bars', coalesce((
    select jsonb_agg(public.olnu_sport_info(x.id, null) || jsonb_build_object('name', x.name, 'type', x.type, 'lat', x.lat, 'lng', x.lng,
             'town', public.olnu_town_of(x.lat, x.lng)))
      from (select * from public.bars_lite b where b.active and b.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
             order by (b.type in ('bar', 'pub', 'nightclub')) desc, b.name limit 20) x), '[]'::jsonb));
end; $function$;
