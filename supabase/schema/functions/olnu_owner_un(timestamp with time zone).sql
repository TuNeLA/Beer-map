-- public.olnu_owner_un(p_first timestamp with time zone)
-- live md5(pg_get_functiondef) = d539299c343e58f2fdc9f2ec81a8adb8
CREATE OR REPLACE FUNCTION public.olnu_owner_un(p_first timestamp with time zone)
 RETURNS TABLE(night timestamp with time zone, user_id uuid, b integer, o integer, home boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if to_regclass('public.medal_nights') is not null then
    return query
    select x.night, x.user_id, max(x.b)::int, max(x.o)::int, bool_or(x.home)
      from (select mn.night, mn.user_id, mn.beers b, mn.others o, mn.home
              from public.medal_nights mn where mn.night >= p_first
            union all
            select bb.expires_at, bb.user_id, coalesce(bb.beer_count, 0),
                   coalesce(bb.other_count, 0) + coalesce(bb.shot_count, 0), false
              from public.beers bb where bb.expires_at >= p_first) x
     group by 1, 2;
  else
    return query
    select bb.expires_at, bb.user_id, coalesce(bb.beer_count, 0)::int,
           (coalesce(bb.other_count, 0) + coalesce(bb.shot_count, 0))::int, false
      from public.beers bb where bb.expires_at >= p_first;
  end if;
end; $function$;
