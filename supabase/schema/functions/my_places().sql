-- public.my_places()
-- live md5(pg_get_functiondef) = cde225de318de923a5f213f999f0aeaa
CREATE OR REPLACE FUNCTION public.my_places()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_bars jsonb; v_towns jsonb; v_dal int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.bar_id, 'name', b.name, 'town', b.town, 'nights', b.nights,
           'lat', round(b.lat::numeric, 5), 'lng', round(b.lng::numeric, 5), 'first', public.olnu_evening(b.first_night))
           order by b.first_night desc nulls last), '[]'::jsonb)
    into v_bars from public.olnu_gw_my_bars(v_uid) b where b.name is not null or b.lat is not null;
  select coalesce(jsonb_agg(jsonb_build_object('town', p.town, 'visited', p.visited, 'total', p.total, 'dalarna', p.dalarna,
           'all', p.total >= 2 and p.visited >= p.total) order by p.visited desc, p.town), '[]'::jsonb),
         count(*) filter (where p.dalarna)::int
    into v_towns, v_dal from public.olnu_gw_town_progress(v_uid) p;
  return jsonb_build_object('v', 1, 'bars', v_bars, 'towns', v_towns, 'bars_n', jsonb_array_length(v_bars),
    'towns_n', jsonb_array_length(v_towns), 'dalarna_n', coalesce(v_dal, 0), 'dalarna_goal', 3);
end $function$;
