-- public.my_stats()
-- live md5(pg_get_functiondef) = 0712eb89196feb2598011e1a6e79672a
CREATE OR REPLACE FUNCTION public.my_stats()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_total int := public.olnu_lifetime(v_uid);
  v_m int := public.olnu_meriter(v_uid);
  v_week int;
  v_tn int;
  r record;
begin
  select coalesce(sum(w.n), 0)::int into v_week from public.week_beers w where w.user_id = v_uid and w.week = public.olnu_week_start(now());
  select coalesce(sum(l.pts), 0)::int into v_tn from public.meriter_log l
   where l.user_id = v_uid and l.night = public.olnu_night_of(now());
  select * into r from public.olnu_rank_of(v_m);
  return json_build_object('total', v_total, 'week', v_week, 'title', r.title, 'next_title', r.next_title, 'next_at', r.next_at,
                           'meriter', v_m, 'rank', r.idx, 'ranks', r.n, 'rank_at', r.at, 'tonight_meriter', v_tn);
end; $function$;
