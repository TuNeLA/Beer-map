-- public.kebab_top(p_lat double precision, p_lng double precision, p_month_offset integer)
-- live md5(pg_get_functiondef) = a11d751560d22f09bac71ddf1f8a7053
CREATE OR REPLACE FUNCTION public.kebab_top(p_lat double precision, p_lng double precision, p_month_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_town text;
  v_month date := (date_trunc('month', now() at time zone 'Europe/Stockholm')
                   - make_interval(months => least(greatest(coalesce(p_month_offset, 0), 0), 12)))::date;
  v_list jsonb;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_town := public.olnu_gang_town(p_lat, p_lng);
  with latest as (
    select distinct on (k.user_id, k.place_id) k.* from public.kebab_ratings k
     where k.town = v_town and k.month = v_month
     order by k.user_id, k.place_id, k.updated_at desc
  ), agg as (
    select l.place_id, max(l.place_name) as name, avg(l.lat) as lat, avg(l.lng) as lng,
           round(avg(l.stars)::numeric, 2) as avg, count(*)::int as n, min(l.created_at) as first_at,
           (select l2.tag from latest l2 where l2.place_id = l.place_id and l2.tag is not null
             group by l2.tag order by count(*) desc, l2.tag limit 1) as tag,
           max(case when l.user_id = v_uid then l.stars end) as my_stars
      from latest l group by l.place_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', x.rk, 'place_id', x.place_id, 'name', x.name, 'lat', x.lat, 'lng', x.lng,
           'avg', x.avg, 'n', x.n, 'tag', x.tag, 'my_stars', x.my_stars) order by x.rk), '[]'::jsonb)
    into v_list
    from (select a.*, row_number() over (order by a.avg desc, a.n desc, a.first_at)::int as rk from agg a) x
   where x.rk <= 10;
  return jsonb_build_object('town', case when left(v_town, 1) = '~' then null else v_town end,
                            'month', v_month, 'list', v_list);
end; $function$;
