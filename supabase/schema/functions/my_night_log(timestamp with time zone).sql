-- public.my_night_log(p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = ad8ba150971dc44451f33926503503df
CREATE OR REPLACE FUNCTION public.my_night_log(p_night timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_cur timestamptz := public.olnu_night_of(now());
  v_night timestamptz;
  v_from timestamptz;
  v_nights jsonb;
  v_items jsonb;
  v_src text;
  v_mn record;
  v_n int; v_first timestamptz; v_last timestamptz; v_bars int; v_kinds jsonb; v_hours jsonb; v_ci int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('night', x.night, 'evening', public.olnu_evening(x.night), 'drinks', x.drinks, 'log', x.log)
                            order by x.night desc), '[]'::jsonb)
    into v_nights
    from (select n.night, max(n.drinks)::int as drinks, bool_or(n.log) as log from (
            select d.night, count(*) filter (where d.kind <> 'checkin')::int as drinks, true as log
              from public.drink_log d where d.user_id = v_uid and not d.undone and d.night > now() - interval '90 days' group by d.night
            union all
            select m.night, (m.beers + m.others)::int, false from public.medal_nights m
             where m.user_id = v_uid and m.night > now() - interval '90 days' and (m.beers + m.others) > 0
            union all
            select t.night, 0, false from public.crew_tracks t
             where t.user_id = v_uid and t.kind = 'ci' and t.night > now() - interval '90 days' group by t.night
          ) n group by n.night order by n.night desc limit 40) x;

  if p_night is not null then
    v_night := public.olnu_night_of(p_night - interval '1 second');
    if v_night > v_cur then v_night := v_cur; end if;
  elsif exists (select 1 from jsonb_array_elements(v_nights) e where (e.value ->> 'night')::timestamptz = v_cur) then
    v_night := v_cur;
  else
    v_night := coalesce((v_nights -> 0 ->> 'night')::timestamptz, v_cur);
  end if;
  v_from := v_night - interval '24 hours';

  if exists (select 1 from public.drink_log d where d.user_id = v_uid and d.night = v_night) then
    v_src := 'log';
    select coalesce(jsonb_agg(jsonb_build_object('at', d.at, 'kind', d.kind, 'bar', d.bar_name, 'bar_id', d.bar_id, 'area', d.area,
                              'ghost', d.ghost) order by d.at, d.id), '[]'::jsonb)
      into v_items
      from (select * from public.drink_log x where x.user_id = v_uid and x.night = v_night and not x.undone order by x.at, x.id limit 200) d;
  else
    select coalesce(jsonb_agg(z.j order by z.at), '[]'::jsonb) into v_items from (
      select l.at, jsonb_build_object('at', l.at, 'kind', 'unknown', 'bar', null, 'area', null, 'ghost', false) as j
        from public.duel_log l, generate_series(1, least(greatest(l.n, 0), 5))
       where l.user_id = v_uid and l.kind = 'drink' and l.n > 0 and l.at >= v_from and l.at < v_night
      union all
      select t.at, jsonb_build_object('at', t.at, 'kind', 'checkin', 'bar', t.bar_name, 'bar_id', t.bar_id, 'area', null, 'ghost', false)
        from public.crew_tracks t where t.user_id = v_uid and t.kind = 'ci' and t.night = v_night
      order by 1 limit 200) z;
    v_src := case when jsonb_array_length(v_items) > 0 then 'legacy' else 'none' end;
  end if;

  select m.beers, m.others, m.first_at into v_mn from public.medal_nights m where m.user_id = v_uid and m.night = v_night;
  select count(*) filter (where e.value ->> 'kind' <> 'checkin')::int,
         min((e.value ->> 'at')::timestamptz) filter (where e.value ->> 'kind' <> 'checkin'),
         max((e.value ->> 'at')::timestamptz) filter (where e.value ->> 'kind' <> 'checkin'),
         count(distinct coalesce(e.value ->> 'bar_id', e.value ->> 'bar')) filter (where coalesce(e.value ->> 'bar', '') <> '')::int,
         count(*) filter (where e.value ->> 'kind' = 'checkin')::int
    into v_n, v_first, v_last, v_bars, v_ci
    from jsonb_array_elements(v_items) e;
  select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) into v_kinds
    from (select e.value ->> 'kind' as kind, count(*)::int as n from jsonb_array_elements(v_items) e
           where e.value ->> 'kind' not in ('checkin', 'unknown') group by 1) k;
  select coalesce(jsonb_agg(jsonb_build_object('h', h.h, 'n', h.n) order by h.o), '[]'::jsonb) into v_hours
    from (select to_char((e.value ->> 'at')::timestamptz at time zone 'Europe/Stockholm', 'HH24') as h,
                 min((e.value ->> 'at')::timestamptz) as o, count(*)::int as n
            from jsonb_array_elements(v_items) e where e.value ->> 'kind' <> 'checkin' group by 1) h;

  return jsonb_build_object('v', 1, 'now', now(), 'night', v_night, 'evening', public.olnu_evening(v_night),
    'tonight', v_night = v_cur, 'source', v_src, 'items', v_items, 'nights', v_nights,
    'stats', jsonb_build_object(
      'drinks', greatest(coalesce(v_n, 0), coalesce(v_mn.beers + v_mn.others, 0)),
      'logged', coalesce(v_n, 0),
      'beers', coalesce(v_mn.beers, (v_kinds ->> 'beer')::int, 0), 'others', coalesce(v_mn.others, 0),
      'kinds', v_kinds,
      'first_at', coalesce(v_first, v_mn.first_at), 'last_at', v_last,
      'per_hour', case when coalesce(v_n, 0) >= 2 and v_last > v_first
                       then round((v_n / greatest(0.5, extract(epoch from (v_last - v_first)) / 3600.0))::numeric, 1)::float8 end,
      'bars', coalesce(v_bars, 0), 'checkins', coalesce(v_ci, 0), 'hours', v_hours));
end; $function$;
