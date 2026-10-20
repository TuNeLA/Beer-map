-- 0052 v27 ÖLPASSET. Client: docs/js/passport.js (window.PASSPORT) + docs/passport.css.
-- A personal passport: one stamp per bar you visited (check-ins + "Kung av baren" taps via medal_checkins, and
-- drinks whose pin snapped to a bar via crew_tracks kind 'drink'), one per town (after_nights.town + the town of
-- every stamped bar), and a flag for "abroad" (a bar that is neither in bars_lite (Sweden) nor near a Swedish
-- town). Only the caller's own data; bar positions are public bar points (never a pin, never a home).
-- Read only: no new tables. Needs 0001-0035 (medal_checkins, crew_tracks, after_nights, bars_lite, board_bars,
-- bar_taps, checkins, olnu_town_of, olnu_evening, olnu_uid). Safe to run again.

-- my_passport() -> {v, bars:[{id, name, lat, lng, type, nights, first, last, town, in_se}],
--                   towns:[{town, nights, first, last}], bars_n, towns_n, nights_n, abroad, first_abroad}
create or replace function public.my_passport()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_bars  jsonb := '[]'::jsonb;
  v_towns jsonb := '[]'::jsonb;
  v_nights int := 0;
begin
  with visits as (
    select mc.bar_id, mc.night from public.medal_checkins mc where mc.user_id = v_uid
    union
    select ct.bar_id, ct.night from public.crew_tracks ct
     where ct.user_id = v_uid and ct.kind = 'drink' and ct.bar_id is not null
  ), per as (
    select v.bar_id, count(distinct v.night)::int as nights, min(v.night) as first, max(v.night) as last
      from visits v where v.bar_id is not null and char_length(v.bar_id) between 1 and 80
     group by v.bar_id
  ), pos as (
    select p.*, bl.name as bl_name, bl.type as bl_type,
           coalesce(bl.lat, bb.lat) as lat, coalesce(bl.lng, bb.lng) as lng, bl.id is not null as in_lite,
           (select bt.bar_name from public.bar_taps bt where bt.user_id = v_uid and bt.bar_id = p.bar_id
             order by bt.last_at desc limit 1) as bt_name,
           (select ct.bar_name from public.crew_tracks ct where ct.user_id = v_uid and ct.bar_id = p.bar_id
             and ct.bar_name is not null order by ct.at desc limit 1) as ct_name,
           (select ci.bar_name from public.checkins ci where ci.user_id = v_uid and ci.bar_id = p.bar_id) as ci_name
      from per p
      left join public.bars_lite bl on bl.id = p.bar_id
      left join public.board_bars bb on bb.bar_id = p.bar_id
  ), full_rows as (
    select x.*, coalesce(x.bl_name, x.ct_name, x.bt_name, x.ci_name) as name,
           public.olnu_town_of(x.lat, x.lng) as town
      from pos x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.bar_id, 'name', f.name, 'lat', round(f.lat::numeric, 5), 'lng', round(f.lng::numeric, 5),
           'type', f.bl_type, 'nights', f.nights,
           'first', public.olnu_evening(f.first), 'last', public.olnu_evening(f.last), 'town', f.town,
           'in_se', f.in_lite or f.town is not null or f.lat is null) order by f.first, f.bar_id), '[]'::jsonb)
    into v_bars from full_rows f;

  with t as (
    select an.town, an.night from public.after_nights an where an.user_id = v_uid and an.town is not null
    union
    select b->>'town', (select mc.night from public.medal_checkins mc where mc.user_id = v_uid and mc.bar_id = b->>'id'
                        order by mc.night limit 1)
      from jsonb_array_elements(v_bars) b where b->>'town' is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('town', x.town, 'nights', x.nights,
           'first', public.olnu_evening(x.first), 'last', public.olnu_evening(x.last)) order by x.first), '[]'::jsonb)
    into v_towns
    from (select t.town, count(distinct t.night)::int as nights, min(t.night) as first, max(t.night) as last
            from t where t.night is not null group by t.town) x;

  select count(*) into v_nights from (
    select mn.night from public.medal_nights mn where mn.user_id = v_uid and mn.beers + mn.others > 0
    union select mc.night from public.medal_checkins mc where mc.user_id = v_uid) n;

  return jsonb_build_object('v', 1, 'bars', v_bars, 'towns', v_towns,
    'bars_n', jsonb_array_length(v_bars), 'towns_n', jsonb_array_length(v_towns), 'nights_n', v_nights,
    'abroad', exists (select 1 from jsonb_array_elements(v_bars) b where not (b->>'in_se')::boolean),
    'first_abroad', (select min(b->>'first') from jsonb_array_elements(v_bars) b where not (b->>'in_se')::boolean));
end;
$$;

do $$
begin
  execute 'revoke all on function public.my_passport() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.my_passport() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.my_passport() to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.my_passport() to service_role';
  end if;
end $$;
