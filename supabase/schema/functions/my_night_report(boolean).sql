-- public.my_night_report(p_last boolean)
-- live md5(pg_get_functiondef) = 0cd1fe664d96defd4187363a4e9e46cd
CREATE OR REPLACE FUNCTION public.my_night_report(p_last boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := case when coalesce(p_last, true)
                           then public.olnu_night_of(now() - interval '24 hours')
                           else public.olnu_night_of(now()) end;
  v_mn    record;
  v_an    record;
  v_bars  int := 0;
  v_types jsonb := '[]'::jsonb;
  v_week  int := 0;
begin
  select mn.beers, mn.others, mn.first_at, mn.home into v_mn from public.medal_nights mn
   where mn.user_id = v_uid and mn.night = v_night;
  select an.checkins, an.skal_given, an.skal_got, an.home_at, an.town into v_an from public.after_nights an
   where an.user_id = v_uid and an.night = v_night;
  select count(distinct c.bar_id) into v_bars from public.medal_checkins c where c.user_id = v_uid and c.night = v_night;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'n', x.n) order by x.n desc), '[]'::jsonb) into v_types
      from (select bt.type, count(*)::int n from public.beer_types bt
             where bt.user_id = v_uid and bt.night = v_night group by bt.type) x;
  exception when others then
    v_types := '[]'::jsonb;
  end;
  select count(*) into v_week from public.medal_nights mn
   where mn.user_id = v_uid and mn.night < v_night and mn.night >= v_night - interval '7 days'
     and mn.beers + mn.others > 0;
  return jsonb_build_object(
    'night', v_night,
    'evening', public.olnu_evening(v_night),
    'out', coalesce(v_mn.beers, 0) + coalesce(v_mn.others, 0) > 0,
    'beers', coalesce(v_mn.beers, 0),
    'others', coalesce(v_mn.others, 0),
    'first_at', v_mn.first_at,
    'bars', coalesce(v_bars, 0),
    'checkins', coalesce(v_an.checkins, 0),
    'skal_given', coalesce(v_an.skal_given, 0),
    'skal_got', coalesce(v_an.skal_got, 0),
    'home', v_an.home_at is not null or coalesce(v_mn.home, false),
    'home_at', v_an.home_at,
    'town', v_an.town,
    'types', v_types,
    'nights_week_before', coalesce(v_week, 0));
end;
$function$;
