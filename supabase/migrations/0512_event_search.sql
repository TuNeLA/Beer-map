-- 0512 · EVENT SEARCH + GO TO THE GAME (lane evsearch, I-73 / I-74 / I-75b / I-76). OWNER-RUN, any time (the client works without it:
-- no search box result = "search is not on yet", no venue block). Additive: two new read functions + one replaced import function.
--   1. events_search(p_q, p_days): the 📅 sheet search box. Matches title / place / town (ilike, % and _ escaped, min 2 chars),
--      every distance (Ludvika from Göteborg). Same rules as events_near: status ok (or my own pending), expires_at > now(),
--      starts in the next p_days (max 31), not older than 12 h; test-zone rows only for test users. Max 50 rows, by starts_at.
--      Same row fields as events_near2 (km = null: no position is sent). Grant: authenticated (events_near has no anon grant).
--   2. event_venue(p_id): for a 📺 TV row with teams → the same game at the arena (swehockey / TheSportsDB row: same teams,
--      start ±15 min) = {arena, town, starts_at, lat, lng, game_url} and a ticket_url ONLY from a Tickster / Ticketmaster row of
--      that game (title has both team words, start ±15 min) or an exact tickster.com / ticketmaster.se link on the arena row.
--      Never a guessed link. Grant: authenticated.
--   3. import_sport_events: unchanged, except it takes an optional "town" per row (the importer's arena table, scripts/sport-venues.json);
--      without it the town is the nearest app town as before. Fixes "Liljas Arena → Kalmar" (I-75b: Nybro is not an app town).
-- Safe to run again (create or replace only).
-- Check after the run (expect t, t, t):
--   select to_regprocedure('public.events_search(text,integer)') is not null,
--          to_regprocedure('public.event_venue(bigint)') is not null,
--          position('v_town' in pg_get_functiondef('public.import_sport_events(jsonb)'::regprocedure)) > 0;

create or replace function public.events_search(p_q text, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(31, coalesce(p_days, 30)));
  v_q text := left(btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g')), 60);
  v_pat text;
  v_test boolean;
begin
  if char_length(v_q) < 2 then
    return jsonb_build_object('v', 1, 'q', v_q, 'days', v_days, 'short', true, 'events', '[]'::jsonb);
  end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_test := coalesce(public.olnu_is_test_user(v_uid), false);
  return jsonb_build_object('v', 1, 'q', v_q, 'days', v_days, 'server_time', now(), 'events', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'kind', x.kind, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
             'bar_id', x.bar_id, 'place', x.place, 'lat', x.lat, 'lng', x.lng, 'town', x.town,
             'url', case when x.status = 'ok' then x.url else null end, 'source', x.source,
             'is_mine', coalesce(x.created_by = v_uid, false), 'pending', x.status = 'pending', 'km', null,
             'sport', x.sport, 'league', x.league, 'home', x.home, 'away', x.away, 'tv', x.tv,
             'ticket_url', case when x.status = 'ok' then coalesce(x.ticket_url, case when x.source in ('ticketmaster', 'tickster') then x.url end) else null end,
             'alt_ids', '[]'::jsonb) order by x.starts_at, x.id)
      from (select e.* from public.bar_events e
             where (e.status = 'ok' or (e.status = 'pending' and v_uid is not null and e.created_by = v_uid))
               and e.expires_at > now() and e.starts_at < now() + make_interval(days => v_days) and e.starts_at > now() - interval '12 hours'
               and (e.title ilike v_pat escape '\' or e.place ilike v_pat escape '\' or e.town ilike v_pat escape '\')
               and (v_test or (v_uid is not null and e.created_by = v_uid)
                    or not coalesce(public.olnu_is_test_zone(coalesce(e.tv_lat, e.lat), coalesce(e.tv_lng, e.lng)), false))
             order by e.starts_at, e.id
             limit 50) x), '[]'::jsonb));
end $$;
revoke all on function public.events_search(text, integer) from public, anon, authenticated;
grant execute on function public.events_search(text, integer) to authenticated;
grant execute on function public.events_search(text, integer) to service_role;

create or replace function public.event_venue(p_id bigint)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with t as (
    select e.id, e.starts_at, coalesce(public.olnu_ev_team(e.home), lower(e.home)) as th, coalesce(public.olnu_ev_team(e.away), lower(e.away)) as ta
      from public.bar_events e
     where e.id = p_id and e.status = 'ok' and e.home is not null and e.away is not null
  ), a as (
    select e.* from public.bar_events e, t
     where not e.tv and e.status = 'ok' and e.expires_at > now() and e.id <> t.id
       and e.home is not null and e.away is not null and e.lat is not null and e.lng is not null
       and e.starts_at between t.starts_at - interval '15 minutes' and t.starts_at + interval '15 minutes'
       and coalesce(public.olnu_ev_team(e.home), lower(e.home)) = t.th and coalesce(public.olnu_ev_team(e.away), lower(e.away)) = t.ta
     order by public.olnu_ev_rank(e.source, true) desc, e.updated_at desc, e.id desc
     limit 1
  ), k as (
    select coalesce(e.ticket_url, e.url) as u from public.bar_events e, t
     where not e.tv and e.status = 'ok' and e.expires_at > now() and e.source in ('tickster', 'ticketmaster')
       and e.starts_at between t.starts_at - interval '15 minutes' and t.starts_at + interval '15 minutes'
       and t.th = any (public.olnu_ev_words(e.title)) and t.ta = any (public.olnu_ev_words(e.title))
       and coalesce(e.ticket_url, e.url) ~* '^https://' and char_length(coalesce(e.ticket_url, e.url)) <= 300
     order by (e.source = 'tickster') desc, e.id
     limit 1
  )
  select case when not exists (select 1 from t) then jsonb_build_object('v', 1, 'found', false)
    else jsonb_build_object('v', 1, 'found', a.id is not null or exists (select 1 from k),
      'id', a.id, 'arena', a.place, 'town', a.town, 'starts_at', coalesce(a.starts_at, (select t.starts_at from t)), 'lat', a.lat, 'lng', a.lng,
      'game_url', case when a.url ~* '^https://' and char_length(a.url) <= 300 then a.url end,
      'ticket_url', coalesce((select k.u from k),
                             case when a.ticket_url ~* '^https://(secure\.)?tickster\.com/|^https://(www\.)?ticketmaster\.se/' then a.ticket_url end)) end
    from (select 1) d left join a on true;
$$;
revoke all on function public.event_venue(bigint) from public, anon, authenticated;
grant execute on function public.event_venue(bigint) to authenticated;
grant execute on function public.event_venue(bigint) to service_role;

-- 3. import_sport_events: the live body (md5 f216bd8202e3dab534a2b4ad9963cd11) + v_town (row "town" from the arena table first).
create or replace function public.import_sport_events(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  r jsonb; v_ins int := 0; v_upd int := 0; v_skip int := 0; v_new boolean;
  v_src text; v_sid text; v_title text; v_at timestamptz; v_end timestamptz; v_lat float8; v_lng float8; v_url text; v_place text;
  v_tv boolean; v_tlat float8; v_tlng float8; v_tkm int; v_sport text; v_league text; v_home text; v_away text; v_tix text; v_town text;
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
      v_town := left(public.olnu_ev_clean(r->>'town'), 40);
      v_sport := lower(public.olnu_ev_clean(r->>'sport'));
      v_league := left(public.olnu_ev_clean(r->>'league'), 40);
      v_home := left(public.olnu_ev_clean(r->>'home'), 60);
      v_away := left(public.olnu_ev_clean(r->>'away'), 60);
      if v_sport is not null and v_sport not in ('hockey', 'fotboll') then v_sport := null; end if;
      if v_town is not null and (char_length(v_town) < 2 or v_town ~ '[<>"&;\\/0-9]') then v_town := null; end if;
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
              round(v_lat::numeric, 5), round(v_lng::numeric, 5), case when v_tv then null else coalesce(v_town, public.olnu_town_of(v_lat, v_lng)) end,
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
end; $function$;

select public.olnu_strip_cr();
