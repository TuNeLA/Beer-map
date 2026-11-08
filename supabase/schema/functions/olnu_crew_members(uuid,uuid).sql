-- public.olnu_crew_members(p_group uuid, p_viewer uuid)
-- live md5(pg_get_functiondef) = fb45b1b19f59dacd0231dee87b76b7bd
CREATE OR REPLACE FUNCTION public.olnu_crew_members(p_group uuid, p_viewer uuid)
 RETURNS TABLE(uid uuid, k text, name text, is_me boolean, state text, left_at timestamp with time zone, lat double precision, lng double precision, bar_id text, bar_name text, pres_at timestamp with time zone, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with m as (
    select gm.user_id, gm.display_name, gm.joined_at from public.group_members gm where gm.group_id = p_group
  ), x as (
    select m.user_id, m.display_name, m.joined_at, p.lat, p.lng, p.bar_id, p.bar_name, p.at,
           (select y.at from public.crew_byes y where y.user_id = m.user_id and y.night = v_night and y.cleared_at is null) as bye_at,
           (select an.home_at from public.after_nights an where an.user_id = m.user_id and an.night = v_night) as home_at,
           coalesce((select an.out from public.after_nights an where an.user_id = m.user_id and an.night = v_night), false) as was_out
      from m left join lateral public.olnu_crew_pres(m.user_id) p on true
  )
  select x.user_id, public.olnu_crew_k(p_group, x.user_id), x.display_name, x.user_id = p_viewer,
         case
           when x.at is not null and (x.bye_at is null or x.at > x.bye_at) and (x.home_at is null or x.at > x.home_at) then 'out'
           when x.bye_at is not null and (x.home_at is null or x.bye_at >= x.home_at) then 'left'
           when x.home_at is not null then 'home'
           when x.was_out then 'quiet'
           else 'none'
         end,
         greatest(x.bye_at, x.home_at),
         x.lat, x.lng, x.bar_id, x.bar_name, x.at, x.joined_at
    from x;
end; $function$;
