-- public.olnu_gw_town_progress(p_uid uuid)
-- live md5(pg_get_functiondef) = 6a2482faa760d264855d3ad3c4b9a0da
CREATE OR REPLACE FUNCTION public.olnu_gw_town_progress(p_uid uuid)
 RETURNS TABLE(town text, visited integer, total integer, dalarna boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (select * from public.olnu_gw_my_bars(p_uid) where town is not null),
  towns as (select distinct m.town from mine m),
  tot as (
    select t.town, count(*)::int as n, array_agg(b.id) as ids
      from towns t join public.olnu_towns ot on ot.name = t.town
      join public.bars_lite b on b.active and b.type in ('pub', 'bar', 'nightclub', 'biergarten')
                             and abs(b.lat - ot.lat) < 0.3 and abs(b.lng - ot.lng) < 0.6
     where public.olnu_town_of(b.lat, b.lng) = t.town
     group by t.town
  )
  select t.town,
         (select count(*)::int from mine m where m.town = t.town and m.bar_id = any (coalesce(x.ids, '{}'))),
         coalesce(x.n, 0), public.olnu_gw_dalarna(t.town)
    from towns t left join tot x on x.town = t.town;
$function$;
