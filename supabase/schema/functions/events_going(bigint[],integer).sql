-- public.events_going(p_ids bigint[], p_days integer)
-- live md5(pg_get_functiondef) = 17b39476ca31388dcc731837485a87d1
CREATE OR REPLACE FUNCTION public.events_going(p_ids bigint[] DEFAULT NULL::bigint[], p_days integer DEFAULT 31)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(31, coalesce(p_days, 31)));
  v_ids bigint[] := (select array_agg(distinct x) from (select unnest(coalesce(p_ids, '{}'::bigint[])) x limit 400) s);
  v_ev jsonb; v_fr jsonb;
begin
  select coalesce(jsonb_agg(public.olnu_evgo_json(d.event_id, v_uid) order by d.event_id), '[]'::jsonb) into v_ev
    from (select distinct g.event_id from public.event_going g
           where g.event_id = any(coalesce(v_ids, '{}'::bigint[])) and g.going) d;
  with c as (select uid from public.olnu_evgo_circle(v_uid)),
       f as (select distinct g.event_id from public.event_going g where g.going and g.user_id in (select uid from c))
  select coalesce(jsonb_agg(public.olnu_evgo_json(e.id, v_uid) || jsonb_build_object(
           'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'bar_id', e.bar_id, 'place', e.place,
           'lat', e.lat, 'lng', e.lng, 'town', e.town, 'sport', e.sport, 'league', e.league, 'home', e.home, 'away', e.away, 'tv', e.tv,
           'url', e.url, 'source', e.source, 'pending', false, 'is_mine', false,
           'ticket_url', coalesce(e.ticket_url, case when e.source in ('ticketmaster', 'tickster') then e.url end))
           order by e.starts_at, e.id), '[]'::jsonb) into v_fr
    from (select e.* from public.bar_events e join f on f.event_id = e.id
           where e.status = 'ok' and e.expires_at > now() and e.starts_at < now() + make_interval(days => v_days)
           order by e.starts_at, e.id limit 20) e;
  return jsonb_build_object('v', 1, 'events', v_ev, 'friends', v_fr);
end; $function$;
