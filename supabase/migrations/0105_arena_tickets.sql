-- Öl Nu — 🏟️ ARENOR: 🎟️ ticket links + arenas as check-in places (CONTRACT "ARENOR · matchpins, glöd och incheckning").
-- Additive. Needs 0015/0016 (bars_lite, olnu_near_bar), 0065 (bar_events, olnu_ev_clean), 0100 (import_sport_events, events_near2).
--  1. bar_events.ticket_url: the 🎟️ link for a match (scripts/sport-tickets.json club page, or the exact Tickster match).
--     import_sport_events stores it (new optional row field "ticket_url", https only); events_near2 returns it as a NEW field
--     "ticket_url" (old fields unchanged) = ticket_url, else url for rows from a ticket seller (source ticketmaster / tickster).
--  2. olnu_near_bar: an arena (bars_lite.type = 'arena', migration 0106) catches pins within 110 m (a hall is big; bars 75 m,
--     restaurants 40 m as before). Same order as before: bars / arenas before restaurants, then the nearest.

alter table public.bar_events add column if not exists ticket_url text;

create or replace function public.import_sport_events(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_ins int := 0; v_upd int := 0; v_skip int := 0; v_new boolean;
  v_src text; v_sid text; v_title text; v_at timestamptz; v_end timestamptz; v_lat float8; v_lng float8; v_url text; v_place text;
  v_tv boolean; v_tlat float8; v_tlng float8; v_tkm int; v_sport text; v_league text; v_home text; v_away text; v_tix text;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'invalid_rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_src := lower(left(public.olnu_ev_clean(r->>'source'), 20));
      v_sid := left(public.olnu_ev_clean(r->>'source_id'), 200);
      v_title := left(public.olnu_ev_clean(r->>'title'), 80);
      v_at := (r->>'starts_at')::timestamptz;
      v_end := nullif(r->>'ends_at', '')::timestamptz;
      v_tv := coalesce((r->>'tv')::boolean, false);
      v_lat := nullif(r->>'lat', '')::float8; v_lng := nullif(r->>'lng', '')::float8;
      v_url := public.olnu_ev_clean(r->>'url');
      v_tix := public.olnu_ev_clean(r->>'ticket_url');
      v_place := left(public.olnu_ev_clean(r->>'place'), 60);
      v_sport := lower(public.olnu_ev_clean(r->>'sport'));
      v_league := left(public.olnu_ev_clean(r->>'league'), 40);
      v_home := left(public.olnu_ev_clean(r->>'home'), 60);
      v_away := left(public.olnu_ev_clean(r->>'away'), 60);
      if v_sport is not null and v_sport not in ('hockey', 'fotboll') then v_sport := null; end if;
      if v_src is null or v_src = 'user' or v_sid is null or v_title is null or char_length(v_title) < 3 or v_at is null
         or v_at < now() - interval '12 hours' or v_at > now() + interval '90 days' then v_skip := v_skip + 1; continue; end if;
      if v_tv then
        v_lat := null; v_lng := null;
        v_tlat := nullif(r->>'tv_lat', '')::float8; v_tlng := nullif(r->>'tv_lng', '')::float8;
        v_tkm := greatest(20, least(1000, coalesce(nullif(r->>'tv_km', '')::int, 200)));
        if v_tlat is null or v_tlng is null or not public.olnu_world_ok(v_tlat, v_tlng) then v_tlat := null; v_tlng := null; v_tkm := null; end if;
      else
        v_tlat := null; v_tlng := null; v_tkm := null;
        if v_lat is null or v_lng is null or not public.olnu_world_ok(v_lat, v_lng) then v_skip := v_skip + 1; continue; end if;
      end if;
      if v_url is not null and (v_url !~* '^https?://' or char_length(v_url) > 300) then v_url := null; end if;
      if v_tix is not null and (v_tix !~* '^https://' or char_length(v_tix) > 300) then v_tix := null; end if;
      if v_end is not null and (v_end < v_at or v_end > v_at + interval '1 day') then v_end := null; end if;
      insert into public.bar_events as e (source, source_id, title, kind, starts_at, ends_at, bar_id, place, lat, lng, town, url, status, expires_at,
                                          sport, league, home, away, tv, tv_lat, tv_lng, tv_km, ticket_url)
      values (v_src, v_sid, v_title, 'sport', v_at, v_end,
              case when v_tv then null else public.olnu_ev_bar(v_lat, v_lng) end, v_place,
              round(v_lat::numeric, 5), round(v_lng::numeric, 5), case when v_tv then null else public.olnu_town_of(v_lat, v_lng) end,
              v_url, 'ok', coalesce(v_end, v_at + interval '3 hours'),
              v_sport, v_league, v_home, v_away, v_tv, v_tlat, v_tlng, v_tkm, v_tix)
      on conflict (source, source_id) where source_id is not null do update
        set title = excluded.title, kind = 'sport', starts_at = excluded.starts_at, ends_at = excluded.ends_at, bar_id = excluded.bar_id,
            place = excluded.place, lat = excluded.lat, lng = excluded.lng, town = excluded.town, url = excluded.url,
            expires_at = excluded.expires_at, sport = excluded.sport, league = excluded.league, home = excluded.home, away = excluded.away,
            tv = excluded.tv, tv_lat = excluded.tv_lat, tv_lng = excluded.tv_lng, tv_km = excluded.tv_km, ticket_url = excluded.ticket_url, updated_at = now()
      returning (xmax = 0) into v_new;
      if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then v_skip := v_skip + 1;
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip);
end; $$;

create or replace function public.events_near2(p_lat float8, p_lng float8, p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(14, coalesce(p_days, 7)));
  v_cos float8;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_cos := greatest(0.2, cos(radians(p_lat)));
  return jsonb_build_object('v', 1, 'server_time', now(), 'events', coalesce((
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
        ) u order by u.starts_at, u.id limit 150) x), '[]'::jsonb));
end; $$;

create or replace function public.olnu_near_bar(p_lat float8, p_lng float8)
returns table (id text, lat float8, lng float8)
language sql
stable
set search_path = public
as $$
  select bl.id, bl.lat, bl.lng
    from public.bars_lite bl
   where bl.active
     and bl.lat between p_lat - 0.001 and p_lat + 0.001
     and bl.lng between p_lng - 0.0027 and p_lng + 0.0027
     and power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2)
         <= case when coalesce(bl.type, '') in ('restaurant', 'fast_food', 'cafe') then 1600
                 when bl.type = 'arena' then 12100 else 5625 end
   order by (coalesce(bl.type, '') in ('restaurant', 'fast_food', 'cafe')),
            power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2), bl.id
   limit 1;
$$;

revoke all on function public.olnu_near_bar(float8, float8) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_near_bar(float8, float8) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_near_bar(float8, float8) from authenticated';
  end if;
end $$;

revoke all on function public.import_sport_events(jsonb) from public, anon, authenticated;
revoke all on function public.events_near2(float8, float8, int) from public, anon;
grant execute on function public.import_sport_events(jsonb) to service_role;
grant execute on function public.events_near2(float8, float8, int) to authenticated;
