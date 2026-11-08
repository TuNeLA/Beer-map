-- public.my_wrapped(p_kind text, p_offset integer)
-- live md5(pg_get_functiondef) = 8e294f5fd6e2ab54a6034dcff790ea0b
CREATE OR REPLACE FUNCTION public.my_wrapped(p_kind text DEFAULT 'month'::text, p_offset integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_kind text := case when lower(coalesce(p_kind, '')) = 'year' then 'year' else 'month' end;
  v_off  int := greatest(0, least(24, coalesce(p_offset, 1)));
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  v_from date;
  v_to   date;
  v_nights int := 0; v_beers int := 0; v_others int := 0; v_home int := 0;
  v_bars int := 0; v_sg int := 0; v_sr int := 0; v_towns int := 0;
  v_fav record; v_best record; v_type text; v_type_n int := 0;
  v_fav_name text;
  v_total int := public.olnu_lifetime(v_uid);
  v_title text;
begin
  if v_kind = 'year' then
    v_from := (date_trunc('year', v_today) - make_interval(years => v_off))::date;
    v_to := (v_from + interval '1 year')::date - 1;
  else
    v_from := (date_trunc('month', v_today) - make_interval(months => v_off))::date;
    v_to := (v_from + interval '1 month')::date - 1;
  end if;

  select count(*) filter (where mn.beers + mn.others > 0), coalesce(sum(mn.beers), 0), coalesce(sum(mn.others), 0),
         count(*) filter (where mn.home and mn.beers + mn.others > 0)
    into v_nights, v_beers, v_others, v_home
    from public.medal_nights mn
   where mn.user_id = v_uid and public.olnu_evening(mn.night) between v_from and v_to;

  select count(distinct c.bar_id) into v_bars from public.medal_checkins c
   where c.user_id = v_uid and public.olnu_evening(c.night) between v_from and v_to;

  select c.bar_id, count(distinct c.night)::int n into v_fav from public.medal_checkins c
   where c.user_id = v_uid and public.olnu_evening(c.night) between v_from and v_to
   group by c.bar_id order by count(distinct c.night) desc, max(c.night) desc limit 1;
  if v_fav.bar_id is not null then
    begin
      select bl.name into v_fav_name from public.bars_lite bl where bl.id = v_fav.bar_id;
    exception when others then
      v_fav_name := null;
    end;
    if v_fav_name is null then
      select t.bar_name into v_fav_name from public.bar_taps t where t.bar_id = v_fav.bar_id and t.bar_name is not null
       order by t.last_at desc limit 1;
    end if;
    if v_fav_name is null then
      select c.bar_name into v_fav_name from public.checkins c where c.bar_id = v_fav.bar_id order by c.created_at desc limit 1;
    end if;
  end if;

  select coalesce(sum(an.skal_given), 0), coalesce(sum(an.skal_got), 0),
         count(distinct an.town) filter (where an.town is not null),
         greatest(v_home, count(*) filter (where an.home_at is not null))
    into v_sg, v_sr, v_towns, v_home
    from public.after_nights an
   where an.user_id = v_uid and public.olnu_evening(an.night) between v_from and v_to;

  select public.olnu_evening(mn.night) as evening, mn.beers,
         coalesce((select count(distinct c.bar_id) from public.medal_checkins c where c.user_id = v_uid and c.night = mn.night), 0) as bars
    into v_best
    from public.medal_nights mn
    left join public.after_nights an on an.user_id = mn.user_id and an.night = mn.night
   where mn.user_id = v_uid and public.olnu_evening(mn.night) between v_from and v_to and mn.beers + mn.others > 0
   order by coalesce((select count(distinct c.bar_id) from public.medal_checkins c where c.user_id = v_uid and c.night = mn.night), 0) * 3
            + coalesce(an.skal_given, 0) + coalesce(an.skal_got, 0) + case when an.home_at is not null or mn.home then 2 else 0 end desc,
            mn.beers desc, mn.night desc
   limit 1;

  begin
    select bt.type, count(*)::int into v_type, v_type_n from public.beer_types bt
     where bt.user_id = v_uid and public.olnu_evening(bt.night) between v_from and v_to
     group by bt.type order by count(*) desc, max(bt.created_at) desc limit 1;
  exception when others then
    v_type := null; v_type_n := 0;
  end;

  select t.title into v_title from public.olnu_rank_of(public.olnu_meriter(v_uid)) t;

  return jsonb_build_object(
    'kind', v_kind, 'from', v_from, 'to', v_to,
    'nights', coalesce(v_nights, 0), 'beers', coalesce(v_beers, 0), 'others', coalesce(v_others, 0),
    'home_nights', coalesce(v_home, 0), 'bars', coalesce(v_bars, 0), 'towns', coalesce(v_towns, 0),
    'skal_given', coalesce(v_sg, 0), 'skal_got', coalesce(v_sr, 0),
    'fav_bar_id', v_fav.bar_id, 'fav_bar_name', v_fav_name, 'fav_bar_nights', coalesce(v_fav.n, 0),
    'best_evening', v_best.evening, 'best_beers', coalesce(v_best.beers, 0), 'best_bars', coalesce(v_best.bars, 0),
    'top_type', v_type, 'top_type_n', coalesce(v_type_n, 0),
    'total', coalesce(v_total, 0), 'title', v_title, 'meriter', public.olnu_meriter(v_uid));
end;
$function$;
