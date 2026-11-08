-- public.live_checkins()
-- live md5(pg_get_functiondef) = 8e51e85efa45073f8933e34262ced730
CREATE OR REPLACE FUNCTION public.live_checkins()
 RETURNS TABLE(bar_id text, bar_name text, lat double precision, lng double precision, name text, is_mine boolean, is_friend boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select c.bar_id, c.bar_name, c.lat, c.lng,
         case when c.user_id = v_uid
              then (select min(mm.display_name) from public.group_members mm where mm.user_id = v_uid)
              else f.fname end,
         (c.user_id = v_uid),
         (c.user_id <> v_uid and f.fname is not null),
         c.created_at
    from public.checkins c
    left join lateral (
      select min(am.display_name) as fname
        from public.group_members am
        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
       where am.user_id = c.user_id and c.user_id <> v_uid
    ) f on true
   where c.expires_at > now() and (c.user_id = v_uid or f.fname is not null or not public.olnu_is_test_zone(c.lat, c.lng) or (select public.olnu_is_test_user(v_uid)))
   order by c.created_at
   limit 2000;
end;
$function$;
