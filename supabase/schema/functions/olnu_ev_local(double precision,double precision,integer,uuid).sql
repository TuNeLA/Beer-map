-- public.olnu_ev_local(p_lat double precision, p_lng double precision, p_days integer, p_uid uuid)
-- live md5(pg_get_functiondef) = 7881918305d88e3ebb5b7208981156ac
CREATE OR REPLACE FUNCTION public.olnu_ev_local(p_lat double precision, p_lng double precision, p_days integer, p_uid uuid)
 RETURNS TABLE(id bigint, alt_ids bigint[], m_ticket text, m_bar text, m_url text, m_sport text, m_league text, m_home text, m_away text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with loc as (
    select e.*, public.olnu_ev_words(e.title) as w, public.olnu_ev_team(e.home) as th, public.olnu_ev_team(e.away) as ta,
           public.olnu_ev_rank(e.source, e.home is not null and e.away is not null) as rk,
           (e.status = 'ok' and e.source <> 'user' and e.created_by is distinct from p_uid) as mergeable
      from public.bar_events e
     where (e.status = 'ok' or (e.status = 'pending' and e.created_by = p_uid))
       and not e.tv
       and e.expires_at > now() and e.starts_at < now() + make_interval(days => p_days) and e.starts_at > now() - interval '12 hours'
       and e.lat between p_lat - 0.27 and p_lat + 0.27
       and e.lng between p_lng - 0.27 / greatest(0.2, cos(radians(p_lat))) and p_lng + 0.27 / greatest(0.2, cos(radians(p_lat)))
  ), pairs as (
    select distinct on (b.id) b.id as loser, a.id as winner
      from loc a
      join loc b on a.id <> b.id and a.mergeable and b.mergeable
                and b.starts_at between a.starts_at - interval '45 minutes' and a.starts_at + interval '45 minutes'
                and abs(a.lat - b.lat) < 0.03 and abs(a.lng - b.lng) < 0.06
                and (a.rk, a.updated_at, a.id) > (b.rk, b.updated_at, b.id)
     where public.olnu_ev_dup(a.lat, a.lng, a.bar_id, a.w, a.th, a.ta, b.lat, b.lng, b.bar_id, b.w, b.th, b.ta)
     order by b.id, a.rk desc, a.updated_at desc, a.id desc
  )
  select k.id,
         (select array_agg(p.loser order by p.loser) from pairs p where p.winner = k.id),
         coalesce(k.ticket_url, case when k.source in ('ticketmaster', 'tickster') then k.url end,
                  (select coalesce(l.ticket_url, l.url) from pairs p join loc l on l.id = p.loser
                    where p.winner = k.id and (l.ticket_url is not null or l.source in ('ticketmaster', 'tickster'))
                    order by (l.source = 'tickster') desc, l.id limit 1)),
         coalesce(k.bar_id, (select l.bar_id from pairs p join loc l on l.id = p.loser where p.winner = k.id and l.bar_id is not null order by l.id limit 1)),
         coalesce(k.url, (select l.url from pairs p join loc l on l.id = p.loser where p.winner = k.id and l.url is not null order by l.id limit 1)),
         coalesce(k.sport, (select l.sport from pairs p join loc l on l.id = p.loser where p.winner = k.id and l.sport is not null order by l.id limit 1)),
         coalesce(k.league, (select l.league from pairs p join loc l on l.id = p.loser where p.winner = k.id and l.league is not null order by l.id limit 1)),
         coalesce(k.home, (select l.home from pairs p join loc l on l.id = p.loser where p.winner = k.id and l.home is not null order by l.id limit 1)),
         coalesce(k.away, (select l.away from pairs p join loc l on l.id = p.loser where p.winner = k.id and l.away is not null order by l.id limit 1))
    from loc k
   where not exists (select 1 from pairs p where p.loser = k.id);
$function$;
