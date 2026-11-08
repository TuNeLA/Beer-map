-- public.olnu_ev_near_json(p_lat double precision, p_lng double precision, p_days integer, p_limit integer, p_uid uuid)
-- live md5(pg_get_functiondef) = 137d89219d4ade496ec4b9a0ccdf2f59
CREATE OR REPLACE FUNCTION public.olnu_ev_near_json(p_lat double precision, p_lng double precision, p_days integer, p_limit integer, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'kind', x.kind, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
             'bar_id', x.m_bar, 'place', x.place, 'lat', x.lat, 'lng', x.lng, 'town', x.town,
             'url', case when x.status = 'ok' then x.m_url else null end, 'source', x.source,
             'is_mine', coalesce(x.created_by = p_uid, false), 'pending', x.status = 'pending',
             'km', case when x.lat is null then null
                        else round((sqrt(power((x.lat - p_lat) * 111.32, 2) + power((x.lng - p_lng) * 111.32 * cos(radians(p_lat)), 2)))::numeric, 1)::float8 end,
             'sport', x.m_sport, 'league', x.m_league, 'home', x.m_home, 'away', x.m_away, 'tv', x.tv,
             'ticket_url', case when x.status = 'ok' then x.m_ticket else null end,
             'alt_ids', coalesce(to_jsonb(x.alt_ids), '[]'::jsonb)) order by x.starts_at, x.id), '[]'::jsonb)
    from (select u.* from (
        select e.*, l.alt_ids, l.m_ticket, l.m_bar, l.m_url, l.m_sport, l.m_league, l.m_home, l.m_away
          from public.olnu_ev_local(p_lat, p_lng, p_days, p_uid) l join public.bar_events e on e.id = l.id
        union all
        select e.*, null::bigint[], coalesce(e.ticket_url, case when e.source in ('ticketmaster', 'tickster') then e.url end),
               e.bar_id, e.url, e.sport, e.league, e.home, e.away
          from public.bar_events e
         where e.tv and e.status = 'ok'
           and (not public.olnu_is_test_zone(coalesce(e.tv_lat, e.lat), coalesce(e.tv_lng, e.lng)) or public.olnu_is_test_zone(p_lat, p_lng) or (select public.olnu_is_test_user(p_uid)))
           and e.expires_at > now() and e.starts_at < now() + make_interval(days => p_days) and e.starts_at > now() - interval '12 hours'
           and (e.tv_lat is null
                or sqrt(power((e.tv_lat - p_lat) * 111.32, 2) + power((e.tv_lng - p_lng) * 111.32 * cos(radians(p_lat)), 2)) <= coalesce(e.tv_km, 200))
        ) u order by u.starts_at, u.id limit p_limit) x;
$function$;
