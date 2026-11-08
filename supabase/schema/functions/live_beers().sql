-- public.live_beers()
-- live md5(pg_get_functiondef) = ab249db2275f759d0e99d1f9637ca7ab
CREATE OR REPLACE FUNCTION public.live_beers()
 RETURNS TABLE(id bigint, lat double precision, lng double precision, beer_count integer, precise boolean, created_at timestamp with time zone, is_mine boolean, friend_name text, skal_count integer, i_skaled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with p as (
    select * from public.olnu_pins(v_uid, null, null, null, null)
  ),
  sk as (
    select s.beer_id as sid, count(*)::int as n, bool_or(s.user_id = v_uid) as mine
      from public.skals s join p on p.beer_id = s.beer_id
     group by s.beer_id
  )
  select p.beer_id, p.lat, p.lng, p.beer_count, p.precise, p.created_at, p.is_mine,
         case when p.is_mine then null else p.friend_name end,
         coalesce(sk.n, 0), coalesce(sk.mine, false)
    from p left join sk on sk.sid = p.beer_id
   order by p.created_at, p.beer_id;
end;
$function$;
