-- public.olnu_takeovers()
-- live md5(pg_get_functiondef) = 3cc0cef5ccbd6a4b0776232351b0f3db
CREATE OR REPLACE FUNCTION public.olnu_takeovers()
 RETURNS TABLE(bar_id text, bar_name text, group_id uuid, n integer, since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start timestamptz := public.olnu_next_expiry() - interval '24 hours';
begin
  return query
  with cand as (
    select distinct on (x.bid) x.bid, x.bname, x.blat, x.blng from (
      select c.bar_id as bid, c.bar_name as bname, c.lat as blat, c.lng as blng, c.created_at as at
        from public.checkins c where c.expires_at > now()
      union all
      select t.bar_id, t.bar_name, t.lat, t.lng, t.last_at
        from public.bar_taps t
       where t.last_at >= v_start and t.lat is not null and t.lng is not null
         and t.week >= public.olnu_week_start(now()) - 7
    ) x
    order by x.bid, x.at desc
  ),
  pres as (
    select c.user_id as uid, c.bar_id as bid, c.created_at as at
      from public.checkins c
     where c.expires_at > now()
    union all
    select b.user_id, nb.bid, coalesce(b.beer_at, b.updated_at)
      from public.beers b
      cross join lateral (
        select cb.bid from cand cb
         where abs(cb.blat - b.lat) < 0.001 and abs(cb.blng - b.lng) < 0.002
           and public.olnu_dist_m(cb.blat, cb.blng, b.lat, b.lng) <= 75
         order by public.olnu_dist_m(cb.blat, cb.blng, b.lat, b.lng)
         limit 1
      ) nb
     where b.expires_at > now() and not b.stopped and b.precise and b.beer_count >= 1
  ),
  one as (
    select distinct on (p.uid) p.uid, p.bid, p.at from pres p where not public.olnu_is_test_user(p.uid) or (select public.olnu_is_test_user(auth.uid())) order by p.uid, p.at desc
  ),
  gp as (
    select o.bid, gm.group_id as gid, count(distinct o.uid)::int as cnt, min(o.at) as first_at
      from one o
      join public.group_members gm on gm.user_id = o.uid
     group by o.bid, gm.group_id
    having count(distinct o.uid) >= 2
  ),
  ranked as (
    select gp.*, row_number() over (partition by gp.bid order by gp.cnt desc, gp.first_at asc, gp.gid) as rn
      from gp
  )
  select r.bid, cand.bname, r.gid, r.cnt, r.first_at
    from ranked r
    left join cand on cand.bid = r.bid
   where r.rn = 1;
end;
$function$;
