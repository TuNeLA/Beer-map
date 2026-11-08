-- public.olnu_gh_get(p_town text)
-- live md5(pg_get_functiondef) = 86328004eb6783d645c869c79c53f060
CREATE OR REPLACE FUNCTION public.olnu_gh_get(p_town text)
 RETURNS golden_horses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week date := date_trunc('week', now() at time zone 'Europe/Stockholm')::date;
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  g public.golden_horses; t record; b record; v_day date; v_at timestamptz; v_days date[];
begin
  select * into g from public.golden_horses h where h.town = p_town and h.week = v_week;
  if found then return g; end if;
  select x.name, x.lat, x.lng into t from public.olnu_towns x where x.name = p_town;
  if not found then return null; end if;
  select x.id, x.name, x.lat, x.lng into b from public.bars_lite x
   where x.active and x.type in ('bar', 'pub', 'nightclub', 'biergarten')
     and x.lat between t.lat - 0.04 and t.lat + 0.04 and x.lng between t.lng - 0.08 and t.lng + 0.08
   order by md5(x.id || ':' || v_week::text || ':olnu-gh') limit 1;
  select array_agg(d::date order by d) into v_days from generate_series(greatest(v_today, v_week + 2), v_week + 5, interval '1 day') d;
  v_day := coalesce(v_days[1 + floor(random() * coalesce(array_length(v_days, 1), 1))::int], v_today);
  v_at := (v_day + make_time(19 + floor(random() * 4)::int, floor(random() * 60)::int, 0)) at time zone 'Europe/Stockholm';
  if v_at < now() then v_at := now() + make_interval(mins => 10 + floor(random() * 50)::int); end if;
  insert into public.golden_horses (town, week, bar_id, bar_name, lat, lng, appears_at, ends_at)
  values (p_town, v_week, b.id, left(b.name, 60), b.lat, b.lng, v_at,
          greatest(v_at + interval '2 hours', ((v_day + 1) + time '02:00') at time zone 'Europe/Stockholm'))
  on conflict (town, week) do nothing;
  select * into g from public.golden_horses h where h.town = p_town and h.week = v_week;
  return g;
end; $function$;
