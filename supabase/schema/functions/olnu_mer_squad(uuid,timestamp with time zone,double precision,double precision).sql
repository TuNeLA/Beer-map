-- public.olnu_mer_squad(p_uid uuid, p_night timestamp with time zone, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 762cbd0e495f88648c912c970db6528d
CREATE OR REPLACE FUNCTION public.olnu_mer_squad(p_uid uuid, p_night timestamp with time zone, p_lat double precision, p_lng double precision)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m   uuid;
  v_hit boolean := false;
begin
  if p_uid is null or p_night is null or p_lat is null or p_lng is null or (p_lat = 0 and p_lng = 0) then
    return 0;
  end if;
  for v_m in
    select distinct b.user_id
      from public.group_members a
      join public.group_members b on b.group_id = a.group_id and b.user_id <> a.user_id
     where a.user_id = p_uid
  loop
    if exists (select 1 from public.beers x
                where x.user_id = v_m and x.expires_at = p_night and not coalesce(x.ghost, false)
                  and (x.beer_count + coalesce(x.other_count, 0)) >= 1 and not (x.lat = 0 and x.lng = 0)
                  and abs(x.lat - p_lat) < 0.002 and public.olnu_dist_m(x.lat, x.lng, p_lat, p_lng) <= 150)
       or exists (select 1 from public.checkins c
                   where c.user_id = v_m and c.expires_at = p_night and not (c.lat = 0 and c.lng = 0)
                     and abs(c.lat - p_lat) < 0.002 and public.olnu_dist_m(c.lat, c.lng, p_lat, p_lng) <= 150)
       or exists (select 1 from public.crew_tracks t
                   where t.user_id = v_m and t.night = p_night and t.lat is not null
                     and abs(t.lat - p_lat) < 0.002 and public.olnu_dist_m(t.lat, t.lng, p_lat, p_lng) <= 150) then
      v_hit := true;
      perform public.olnu_mer_add(v_m, p_night, 'squad', '', 10, 10);
    end if;
  end loop;
  if v_hit then
    return public.olnu_mer_add(p_uid, p_night, 'squad', '', 10, 10);
  end if;
  return 0;
end; $function$;
