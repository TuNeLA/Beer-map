-- Öl Nu — 📅 EVENT DEDUPE (CONTRACT "📅 EN RAD PER EVENT"). Owner 2026-11-07: "the same hockey match shows twice in 📅".
-- Causes seen live: (1) swehockey changed its game id (swh:<number>:<day> → swh:<team slug>:<day>), so old and new rows of one
--   game both live until they expire; (2) a match row (swehockey / TheSportsDB) + a Tickster or Ticketmaster row of the same game;
--   (3) Tickster + Ticketmaster / Visit Sweden rows of one concert ("Flaming Four på Franses" + "Flaming Four @ FRANSES").
-- Fix at read time (old duplicate rows disappear too; the importers also merge before upload, scripts/ev-dedupe.mjs, same rules):
--   two local ok rows are ONE event when they start within ±45 min AND
--     a) both have teams and the teams match (first real word of home and of away: "Ludvika HF" = "Ludvika Hockey Förening"), ≤ 3 km, or
--     b) one has teams and the other's title has both team words, ≤ 3 km, or
--     c) same bar or ≤ 300 m, and the titles share ≥ 50 % of their words (of the longer title; "–", "-", "vs", "@", "på", "(Tal: …)" ignored).
--   The best row stays (teams > Ticketmaster > Tickster > own feeds > Visit Sweden; then the newest update). It takes the missing
--   fields of the others: ticket link (Tickster / Ticketmaster), bar, teams / league, url. New field `alt_ids` = the hidden rows' ids.
--   Never merged: pending rows, user tips (source user), the caller's own rows, TV rows (the client folds TV + local already).
-- Additive: events_near2 / events_near3 keep every field and their limits; one new field (alt_ids). No table change.

create or replace function public.olnu_ev_words(p text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(case when length(w) >= 5 and right(w, 1) = 's' then left(w, length(w) - 1) else w end order by n), '{}')
    from regexp_split_to_table(
           btrim(regexp_replace(
             translate(lower(regexp_replace(coalesce(p, ''), '\([^)]*(\)|$)', ' ', 'g')), 'åäöéèëüáàâêíóúñçø', 'aaoeeeuaaaeiouncø'),
             '[^a-z0-9]+', ' ', 'g')), ' ') with ordinality as x(w, n)
   where length(w) >= 2
     and w <> all (array['vs', 'mot', 'och', 'and', 'the', 'pa', 'at', 'med', 'mfl', 'if', 'ik', 'hc', 'hk', 'bk', 'sk', 'aik', 'ff', 'fk', 'fc',
                         'is', 'hf', 'goif', 'ibk', 'ibf', 'bois', 'hockey', 'ishockey', 'hockeyforening', 'hockeyklubb', 'forening',
                         'idrottsforening', 'idrottsklubb', 'idrottsallskap', 'klubb', 'club', 'fotboll', 'fotbollsklubb', 'tal', 'text', 'svenska',
                         'engelska', 'live', 'biljetter', 'tickets', 'presenterar', 'presents', 'feat', 'ft']);
$$;

-- First real word of a team name ("Ludvika Hockey Förening" → ludvika, "IF Björklöven" → bjorkloven).
create or replace function public.olnu_ev_team(p text)
returns text language sql immutable set search_path = public as $$
  select w from unnest(public.olnu_ev_words(p)) with ordinality as x(w, n) where length(w) >= 3 order by n limit 1;
$$;

create or replace function public.olnu_ev_rank(p_source text, p_teams boolean)
returns int language sql immutable set search_path = public as $$
  select case when p_teams then 100 else 0 end
       + case p_source when 'swehockey' then 60 when 'thesportsdb' then 55 when 'owner' then 50 when 'ticketmaster' then 40
                       when 'tickster' then 38 when 'recurring' then 32 when 'ical' then 30 when 'jsonld' then 30
                       when 'visitsweden' then 20 else 10 end;
$$;

-- Same event? (positions, bars, word lists, team words of two rows)
create or replace function public.olnu_ev_dup(a_lat float8, a_lng float8, a_bar text, a_w text[], a_h text, a_a text,
                                             b_lat float8, b_lng float8, b_bar text, b_w text[], b_h text, b_a text)
returns boolean language sql immutable set search_path = public as $$
  with d as (
    select sqrt(power((a_lat - b_lat) * 111320, 2) + power((a_lng - b_lng) * 111320 * cos(radians(a_lat)), 2)) as m,
           cardinality(array(select unnest(a_w) intersect select unnest(b_w))) as inter,
           greatest(cardinality(a_w), cardinality(b_w)) as mx
  )
  select coalesce(
    (d.m <= 3000 and (
        (a_h is not null and a_a is not null and b_h is not null and b_a is not null and a_h = b_h and a_a = b_a)
     or (a_h is not null and a_a is not null and (b_h is null or b_a is null) and b_w @> array[a_h, a_a])
     or (b_h is not null and b_a is not null and (a_h is null or a_a is null) and a_w @> array[b_h, b_a])))
    or ((d.m <= 300 or (a_bar is not null and a_bar = b_bar)) and d.inter >= 1 and d.mx > 0 and d.inter::float8 / d.mx >= 0.5
        and not (a_h is not null and a_a is not null and b_h is not null and b_a is not null)),
    false)
    from d;
$$;

-- Local rows of one area, deduped. Used by events_near2 / events_near3 (same filters as before).
create or replace function public.olnu_ev_local(p_lat float8, p_lng float8, p_days int, p_uid uuid)
returns table (id bigint, alt_ids bigint[], m_ticket text, m_bar text, m_url text, m_sport text, m_league text, m_home text, m_away text)
language sql stable security definer set search_path = public as $$
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
$$;
revoke all on function public.olnu_ev_local(float8, float8, int, uuid) from public, anon, authenticated;

create or replace function public.olnu_ev_near_json(p_lat float8, p_lng float8, p_days int, p_limit int, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
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
$$;
revoke all on function public.olnu_ev_near_json(float8, float8, int, int, uuid) from public, anon, authenticated;

create or replace function public.events_near2(p_lat double precision, p_lng double precision, p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(14, coalesce(p_days, 7)));
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  return jsonb_build_object('v', 1, 'server_time', now(), 'dedupe', 1, 'events', public.olnu_ev_near_json(p_lat, p_lng, v_days, 150, v_uid));
end; $$;
revoke all on function public.events_near2(double precision, double precision, integer) from public, anon;
grant execute on function public.events_near2(double precision, double precision, integer) to authenticated;

create or replace function public.events_near3(p_lat double precision, p_lng double precision, p_days integer default 31)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(31, coalesce(p_days, 31)));
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  return jsonb_build_object('v', 1, 'server_time', now(), 'days', v_days, 'dedupe', 1,
                            'events', public.olnu_ev_near_json(p_lat, p_lng, v_days, 400, v_uid));
end; $$;
revoke all on function public.events_near3(double precision, double precision, integer) from public, anon;
grant execute on function public.events_near3(double precision, double precision, integer) to authenticated;
revoke all on function public.olnu_ev_words(text) from public, anon;
revoke all on function public.olnu_ev_team(text) from public, anon;
revoke all on function public.olnu_ev_rank(text, boolean) from public, anon;
revoke all on function public.olnu_ev_dup(float8, float8, text, text[], text, text, float8, float8, text, text[], text, text) from public, anon;
