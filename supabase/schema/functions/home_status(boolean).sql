-- public.home_status(p_last boolean)
-- live md5(pg_get_functiondef) = 14c35858597ad7836e884a7bb1bc83d3
CREATE OR REPLACE FUNCTION public.home_status(p_last boolean DEFAULT false)
 RETURNS TABLE(group_id uuid, group_name text, name text, is_me boolean, beers integer, others integer, was_out boolean, home boolean, home_at timestamp with time zone, live boolean, night timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := case when coalesce(p_last, false)
                           then public.olnu_night_of(now() - interval '24 hours')
                           else public.olnu_night_of(now()) end;
begin
  return query
  select g.id, g.name, gm.display_name, gm.user_id = v_uid,
         coalesce(mn.beers, 0), coalesce(mn.others, 0),
         coalesce(mn.beers, 0) + coalesce(mn.others, 0) > 0 or coalesce(an.out, false),
         an.home_at is not null or coalesce(mn.home, false),
         an.home_at,
         (not coalesce(p_last, false)) and exists (select 1 from public.beers b where b.user_id = gm.user_id
            and b.expires_at > now() and not b.stopped and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)),
         v_night
    from public.group_members me
    join public.groups g on g.id = me.group_id
    join public.group_members gm on gm.group_id = me.group_id
    left join public.medal_nights mn on mn.user_id = gm.user_id and mn.night = v_night
    left join public.after_nights an on an.user_id = gm.user_id and an.night = v_night
   where me.user_id = v_uid
   order by g.name, gm.display_name
   limit 1000;
end;
$function$;
