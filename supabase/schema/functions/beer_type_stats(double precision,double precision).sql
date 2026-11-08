-- public.beer_type_stats(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 845374684597d1792fa885232ca70e49
CREATE OR REPLACE FUNCTION public.beer_type_stats(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS TABLE(scope text, period text, type text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_next_expiry();
  v_week  timestamptz := (public.olnu_week_start(now())::timestamp) at time zone 'Europe/Stockholm';
  v_town  boolean := public.olnu_bp_in_sweden(p_lat, p_lng);
begin
  return query
  with w as (
    select bt.type as ty, bt.night as nt, bt.created_at as ca, bt.lat as la, bt.lng as ln
      from public.beer_types bt
     where bt.created_at >= least(v_week, v_night - interval '24 hours')
       and (bt.user_id = v_uid or not public.olnu_is_test_zone(bt.lat, bt.lng) or (select public.olnu_is_test_user(v_uid)))
  )
  select 'sweden'::text, 'night'::text, w.ty, count(*)::int from w where w.nt = v_night group by w.ty
  union all
  select 'sweden', 'week', w.ty, count(*)::int from w
   where w.ca >= v_week group by w.ty
  union all
  select 'town', 'night', w.ty, count(*)::int from w
   where v_town and w.nt = v_night and w.la is not null
     and abs(w.la - p_lat) < 0.2 and abs(w.ln - p_lng) < 0.4
     and public.olnu_dist_m(w.la, w.ln, p_lat, p_lng) <= 20000
   group by w.ty
  union all
  select 'town', 'week', w.ty, count(*)::int from w
   where v_town and w.ca >= v_week and w.la is not null
     and abs(w.la - p_lat) < 0.2 and abs(w.ln - p_lng) < 0.4
     and public.olnu_dist_m(w.la, w.ln, p_lat, p_lng) <= 20000
   group by w.ty;
end;
$function$;
