-- Öl Nu — 📅 EVENT "Månad" (CONTRACT "📅 EVENT MÅNAD + 🍽️ RESTAURANGER PÅ KARTAN"). Additive, needs 0100 + 0105.
-- events_near3(lat, lng, days): the same rows and the same json shape as events_near2 (v 1, server_time, events[] with
-- every events_near2 field), but p_days may be 1–31 (events_near2 caps at 14) and up to 400 rows (events_near2: 150).
-- events_near2 is not changed (old clients and js/arenapin.js keep using it).

create or replace function public.events_near3(p_lat float8, p_lng float8, p_days int default 31)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(31, coalesce(p_days, 31)));
  v_cos float8;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_cos := greatest(0.2, cos(radians(p_lat)));
  return jsonb_build_object('v', 1, 'server_time', now(), 'days', v_days, 'events', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'kind', x.kind, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
             'bar_id', x.bar_id, 'place', x.place, 'lat', x.lat, 'lng', x.lng, 'town', x.town,
             'url', case when x.status = 'ok' then x.url else null end, 'source', x.source,
             'is_mine', coalesce(x.created_by = v_uid, false), 'pending', x.status = 'pending',
             'km', case when x.lat is null then null
                        else round((sqrt(power((x.lat - p_lat) * 111.32, 2) + power((x.lng - p_lng) * 111.32 * cos(radians(p_lat)), 2)))::numeric, 1)::float8 end,
             'sport', x.sport, 'league', x.league, 'home', x.home, 'away', x.away, 'tv', x.tv,
             'ticket_url', case when x.status = 'ok' then coalesce(x.ticket_url, case when x.source in ('ticketmaster', 'tickster') then x.url end) else null end) order by x.starts_at, x.id)
      from (select u.* from (
        select e.* from public.bar_events e
         where (e.status = 'ok' or (e.status = 'pending' and e.created_by = v_uid))
           and not e.tv
           and e.expires_at > now() and e.starts_at < now() + make_interval(days => v_days) and e.starts_at > now() - interval '12 hours'
           and e.lat between p_lat - 0.27 and p_lat + 0.27
           and e.lng between p_lng - 0.27 / v_cos and p_lng + 0.27 / v_cos
        union all
        select e.* from public.bar_events e
         where e.tv and e.status = 'ok'
           and e.expires_at > now() and e.starts_at < now() + make_interval(days => v_days) and e.starts_at > now() - interval '12 hours'
           and (e.tv_lat is null
                or sqrt(power((e.tv_lat - p_lat) * 111.32, 2) + power((e.tv_lng - p_lng) * 111.32 * cos(radians(p_lat)), 2)) <= coalesce(e.tv_km, 200))
        ) u order by u.starts_at, u.id limit 400) x), '[]'::jsonb));
end; $$;

revoke all on function public.events_near3(float8, float8, int) from public, anon;
grant execute on function public.events_near3(float8, float8, int) to authenticated;
