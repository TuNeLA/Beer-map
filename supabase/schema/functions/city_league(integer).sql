-- public.city_league(p_week_offset integer)
-- live md5(pg_get_functiondef) = 92e8d2e22aa96e7e4c60ec90ecddfd4c
CREATE OR REPLACE FUNCTION public.city_league(p_week_offset integer DEFAULT 0)
 RETURNS TABLE(rank integer, town text, points integer, users integer, nights integer, checkins integer, skal integer, home integer, is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_from date := public.olnu_week_start(now()) - 7 * greatest(0, least(52, coalesce(p_week_offset, 0)));
  v_to   date := v_from + 6;
  v_mine text;
begin
  select an.town into v_mine from public.after_nights an
   where an.user_id = v_uid and an.town is not null and public.olnu_evening(an.night) between v_from and v_to
   group by an.town order by count(*) desc, max(an.night) desc limit 1;
  if v_mine is null then
    select an.town into v_mine from public.after_nights an
     where an.user_id = v_uid and an.town is not null order by an.night desc limit 1;
  end if;
  return query
  with f as (
    select an.town as tw, an.user_id as u,
           case when an.out then 1 else 0 end as o,
           case when an.out and an.home_at is not null then 1 else 0 end as h,
           least(an.checkins, 5) as c, least(an.skal_given, 10) as s
      from public.after_nights an
     where an.town is not null and public.olnu_evening(an.night) between v_from and v_to
       and (an.out or an.checkins > 0 or an.skal_given > 0)
  ),
  t as (
    select f.tw, count(distinct f.u)::int as us, sum(f.o)::int as ni, sum(f.c)::int as ci, sum(f.s)::int as sk, sum(f.h)::int as ho,
           round(10.0 * (sum(f.o) + sum(f.h) + 0.5 * sum(f.c) + 0.25 * sum(f.s)) / greatest(1, count(distinct f.u)))::int as pts
      from f group by f.tw
  ),
  r as (
    select t.*, case when t.us >= 3 then (row_number() over (order by (t.us >= 3) desc, t.pts desc, t.us desc, t.tw))::int end as rk
      from t
  )
  select r.rk, r.tw, r.pts, r.us, r.ni, r.ci, r.sk, r.ho, r.tw = v_mine
    from r
   where (r.rk is not null and r.rk <= 12) or r.tw = v_mine
   order by r.rk nulls last, r.tw;
  if v_mine is not null and not exists (select 1 from public.after_nights an where an.town = v_mine
       and public.olnu_evening(an.night) between v_from and v_to) then
    return query select null::int, v_mine, 0, 0, 0, 0, 0, 0, true;
  end if;
end;
$function$;
