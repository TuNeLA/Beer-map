-- 0314 🗺️ MÄRKEN FÖR STÄLLEN, INTE MÄNGD (competitor research ideas 9 + 10, Untappd / Swarm / Bump). Additive only.
-- olnu_gw_place_medals(p_uid) computes the medals. It is NOT named olnu_medal_eval_* on purpose: olnu_medal_store
-- (award_medals) picks up every olnu_medal_eval_* by name, and an old client would toast an unknown id ("pl_ny").
-- 0315 (owner, AFTER the client with the new medal names is live) adds the one-line olnu_medal_eval_places wrapper.
-- Medals count PLACES (check-ins, drinks that snapped to a bar = a visit,
-- like my_passport), never how much anyone drank:
--   pl_ny       🚪 Ny krog         stacks: number of different bars visited (every new bar = +1)
--   pl_stad     🏙️ Hela stan       stacks: towns where you visited every bar (pub / bar / nightclub / biergarten, ≥ 2 of them)
--   pl_dalarna  🧭 Utforskat Dalarna  3 different Dalarna towns
-- ("5 olika barer" already exists as b5 Krogturist, 0012; it is not duplicated.)
-- my_places() (authenticated): own visited bars + towns with progress, for "Mina ställen" in Profil. Bar points are
-- public bar positions, never a pin or a home. Safe to run again. No row is removed.

create or replace function public.olnu_gw_dalarna(p_town text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(p_town, '') in ('Ludvika', 'Smedjebacken', 'Grängesberg', 'Borlänge', 'Falun', 'Säter', 'Hedemora', 'Avesta',
    'Leksand', 'Rättvik', 'Mora', 'Orsa', 'Älvdalen', 'Malung', 'Sälen', 'Vansbro');
$$;

-- Visited bars of a user with the bar's public position and town (one row per bar).
create or replace function public.olnu_gw_my_bars(p_uid uuid)
returns table (bar_id text, name text, lat double precision, lng double precision, type text, town text, nights int, first_night timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with visits as (
    select mc.bar_id, mc.night from public.medal_checkins mc where mc.user_id = p_uid
    union
    select ct.bar_id, ct.night from public.crew_tracks ct where ct.user_id = p_uid and ct.kind = 'drink' and ct.bar_id is not null
  ), per as (
    select v.bar_id, count(distinct v.night)::int as nights, min(v.night) as first_night
      from visits v where v.bar_id is not null and char_length(v.bar_id) between 1 and 80 group by v.bar_id
  )
  select p.bar_id, coalesce(bl.name, (select ci.bar_name from public.checkins ci where ci.user_id = p_uid and ci.bar_id = p.bar_id limit 1)),
         coalesce(bl.lat, bb.lat), coalesce(bl.lng, bb.lng), bl.type,
         public.olnu_town_of(coalesce(bl.lat, bb.lat), coalesce(bl.lng, bb.lng)), p.nights, p.first_night
    from per p
    left join public.bars_lite bl on bl.id = p.bar_id
    left join public.board_bars bb on bb.bar_id = p.bar_id;
$$;

-- Per visited town: how many of its bars (pub / bar / nightclub / biergarten, active) I visited, and how many there are.
create or replace function public.olnu_gw_town_progress(p_uid uuid)
returns table (town text, visited int, total int, dalarna boolean)
language sql stable security definer set search_path to 'public' as $$
  with mine as (select * from public.olnu_gw_my_bars(p_uid) where town is not null),
  towns as (select distinct m.town from mine m),
  tot as (
    select t.town, count(*)::int as n, array_agg(b.id) as ids
      from towns t join public.olnu_towns ot on ot.name = t.town
      join public.bars_lite b on b.active and b.type in ('pub', 'bar', 'nightclub', 'biergarten')
                             and abs(b.lat - ot.lat) < 0.3 and abs(b.lng - ot.lng) < 0.6
     where public.olnu_town_of(b.lat, b.lng) = t.town
     group by t.town
  )
  select t.town,
         (select count(*)::int from mine m where m.town = t.town and m.bar_id = any (coalesce(x.ids, '{}'))),
         coalesce(x.n, 0), public.olnu_gw_dalarna(t.town)
    from towns t left join tot x on x.town = t.town;
$$;

create or replace function public.olnu_gw_place_medals(p_uid uuid)
returns table (medal text, n integer)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_bars int; v_full int; v_dal int;
begin
  select count(*)::int into v_bars from public.olnu_gw_my_bars(p_uid) b where b.lat is not null or b.name is not null;
  select count(*) filter (where p.total >= 2 and p.visited >= p.total)::int, count(*) filter (where p.dalarna)::int
    into v_full, v_dal from public.olnu_gw_town_progress(p_uid) p;
  medal := 'pl_ny'; n := coalesce(v_bars, 0); return next;
  medal := 'pl_stad'; n := coalesce(v_full, 0); return next;
  medal := 'pl_dalarna'; n := case when coalesce(v_dal, 0) >= 3 then 1 else 0 end; return next;
end $$;

create or replace function public.my_places()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_bars jsonb; v_towns jsonb; v_dal int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.bar_id, 'name', b.name, 'town', b.town, 'nights', b.nights,
           'lat', round(b.lat::numeric, 5), 'lng', round(b.lng::numeric, 5), 'first', public.olnu_evening(b.first_night))
           order by b.first_night desc nulls last), '[]'::jsonb)
    into v_bars from public.olnu_gw_my_bars(v_uid) b where b.name is not null or b.lat is not null;
  select coalesce(jsonb_agg(jsonb_build_object('town', p.town, 'visited', p.visited, 'total', p.total, 'dalarna', p.dalarna,
           'all', p.total >= 2 and p.visited >= p.total) order by p.visited desc, p.town), '[]'::jsonb),
         count(*) filter (where p.dalarna)::int
    into v_towns, v_dal from public.olnu_gw_town_progress(v_uid) p;
  return jsonb_build_object('v', 1, 'bars', v_bars, 'towns', v_towns, 'bars_n', jsonb_array_length(v_bars),
    'towns_n', jsonb_array_length(v_towns), 'dalarna_n', coalesce(v_dal, 0), 'dalarna_goal', 3);
end $$;

revoke all on function public.olnu_gw_dalarna(text) from public, anon, authenticated;
revoke all on function public.olnu_gw_my_bars(uuid) from public, anon, authenticated;
revoke all on function public.olnu_gw_town_progress(uuid) from public, anon, authenticated;
revoke all on function public.olnu_gw_place_medals(uuid) from public, anon, authenticated;
revoke all on function public.my_places() from public, anon;
grant execute on function public.my_places() to authenticated;
