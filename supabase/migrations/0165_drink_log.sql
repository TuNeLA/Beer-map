-- Öl Nu — 📊 MIN KVÄLL (CONTRACT "📊 MIN KVÄLL"). A private timeline of MY drinks and check-ins, tonight and past nights.
-- Before: the beers row holds only counters + the LAST beer_at / other_at (one row per person and night); duel_log has drink
-- deltas with a time but no kind/place (and only for group members); crew_tracks has check-ins with bar names.
-- Now: one additive table drink_log (one row per drink or check-in) written by TRIGGERS on beers and checkins, so every
-- existing RPC (post_beer, post_beer_v2, post_other, post_other_v2, undo_beer, check_in …) keeps its exact code and shape.
--   beer_count up → 'beer' rows · other_count up → a row of the other_kind (cider, drink, shot, vin, rom, whisky, grogg, bubbel, annat)
--   other_kind changed without a new drink (post_other_v2 grogg/bubbel) → the newest row of the last 2 min gets the kind
--   beer_count down on the same night (↩️ Ångra) → the newest beer row is marked undone (never removed)
--   a new check-in (insert, or another bar) → a 'checkin' row with the bar name.
-- Position: rounded to 3 decimals (~100 m), the snapped bar (beers.snap_bar) and its name, the town (olnu_town_of).
-- World pins (outside the Sweden box) use the real position from olnu.world_pos. Spökläge drinks are logged as ghost (only I see them).
-- RLS on, no policies, no client access. Rows are never removed; reads filter by user and night. the account erase sweep (0016c) moves user_id.
-- Read: my_night_log(p_night) — only my own rows. Past nights before this table: totals from medal_nights, drink times from
-- duel_log, check-ins from crew_tracks ("legacy" = what exists).

create table if not exists public.drink_log (
  id         bigserial primary key,
  user_id    uuid not null,
  at         timestamptz not null default now(),
  night      timestamptz not null,
  kind       text not null check (kind in ('beer', 'cider', 'drink', 'shot', 'vin', 'rom', 'whisky', 'grogg', 'bubbel', 'annat', 'checkin')),
  lat        double precision,
  lng        double precision,
  bar_id     text,
  bar_name   text,
  area       text,
  ghost      boolean not null default false,
  undone     boolean not null default false
);
create index if not exists drink_log_user_ix on public.drink_log (user_id, night, at);
alter table public.drink_log enable row level security;
revoke all on public.drink_log from anon, authenticated;
grant all on public.drink_log to service_role;
grant usage, select on sequence public.drink_log_id_seq to service_role;

-- Name of a bar / place id (bars_lite has bars + pl_ places).
create or replace function public.olnu_dl_bar_name(p_id text)
returns text language sql stable security definer set search_path = public as $$
  select left(b.name, 60) from public.bars_lite b where b.id = p_id limit 1;
$$;

create or replace function public.olnu_dl_beers_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ob int := 0; v_oo int := 0; v_db int; v_do int;
  v_same boolean := true;
  v_lat float8 := new.lat; v_lng float8 := new.lng;
  v_wp text := coalesce(current_setting('olnu.world_pos', true), '');
  v_ghost boolean := coalesce(current_setting('olnu.ghost', true), '') = '1' or coalesce(new.ghost, false);
  v_night timestamptz := coalesce(new.expires_at, public.olnu_night_of(now()));
  v_bar text; v_name text; v_area text; i int;
begin
  begin
    if tg_op = 'UPDATE' then
      v_same := old.expires_at is not distinct from new.expires_at;
      if v_same then v_ob := coalesce(old.beer_count, 0); v_oo := coalesce(old.other_count, 0); end if;
    end if;
    v_db := coalesce(new.beer_count, 0) - v_ob;
    v_do := coalesce(new.other_count, 0) - v_oo;
    if v_wp ~ '^-?[0-9.]+,-?[0-9.]+$' then
      v_lat := split_part(v_wp, ',', 1)::float8; v_lng := split_part(v_wp, ',', 2)::float8;
    end if;
    if v_db > 0 or v_do > 0 then
      v_bar := case when v_wp = '' then new.snap_bar end;
      v_name := case when v_bar is not null then public.olnu_dl_bar_name(v_bar) end;
      begin v_area := left(public.olnu_town_of(v_lat, v_lng), 40); exception when others then v_area := null; end;
    end if;
    for i in 1 .. least(greatest(v_db, 0), 5) loop
      insert into public.drink_log (user_id, night, kind, lat, lng, bar_id, bar_name, area, ghost)
      values (new.user_id, v_night, 'beer', round(v_lat::numeric, 3), round(v_lng::numeric, 3), v_bar, v_name, v_area, v_ghost);
    end loop;
    for i in 1 .. least(greatest(v_do, 0), 5) loop
      insert into public.drink_log (user_id, night, kind, lat, lng, bar_id, bar_name, area, ghost)
      values (new.user_id, v_night,
              case when new.other_kind in ('cider', 'drink', 'shot', 'vin', 'rom', 'whisky', 'grogg', 'bubbel') then new.other_kind else 'annat' end,
              round(v_lat::numeric, 3), round(v_lng::numeric, 3), v_bar, v_name, v_area, v_ghost);
    end loop;
    if tg_op = 'UPDATE' and v_same and v_db < 0 then
      update public.drink_log d set undone = true
       where d.id in (select x.id from public.drink_log x
                       where x.user_id = new.user_id and x.night = v_night and x.kind = 'beer' and not x.undone
                       order by x.at desc, x.id desc limit least(-v_db, 5));
    end if;
    if tg_op = 'UPDATE' and v_same and v_do = 0 and new.other_kind is distinct from old.other_kind
       and new.other_kind in ('cider', 'drink', 'shot', 'vin', 'rom', 'whisky', 'grogg', 'bubbel', 'annat') then
      update public.drink_log d set kind = new.other_kind
       where d.id = (select x.id from public.drink_log x
                      where x.user_id = new.user_id and x.night = v_night and x.kind not in ('beer', 'checkin')
                        and x.at > now() - interval '2 minutes' and not x.undone
                      order by x.at desc, x.id desc limit 1);
    end if;
  exception when others then
    null;   -- the log must never stop a beer
  end;
  return new;
end; $$;


create or replace function public.olnu_dl_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_area text;
begin
  begin
    if tg_op = 'INSERT' or new.bar_id is distinct from old.bar_id or new.created_at is distinct from old.created_at then
      if new.expires_at > now() and new.lat <> 0 then
        begin v_area := left(public.olnu_town_of(new.lat, new.lng), 40); exception when others then v_area := null; end;
        insert into public.drink_log (user_id, night, kind, lat, lng, bar_id, bar_name, area)
        values (new.user_id, public.olnu_night_of(now()), 'checkin', round(new.lat::numeric, 3), round(new.lng::numeric, 3),
                left(new.bar_id, 80), left(new.bar_name, 60), v_area);
      end if;
    end if;
  exception when others then
    null;   -- the log must never stop a check-in
  end;
  return new;
end; $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'olnu_zz_drink_log' and tgrelid = 'public.beers'::regclass) then
    create trigger olnu_zz_drink_log after insert or update of beer_count, other_count, other_kind on public.beers
      for each row execute function public.olnu_dl_beers_tg();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'olnu_zz_drink_log_ci' and tgrelid = 'public.checkins'::regclass) then
    create trigger olnu_zz_drink_log_ci after insert or update on public.checkins
      for each row execute function public.olnu_dl_checkin_tg();
  end if;
end $$;

-- 📊 Min kväll: my own timeline of one night (null = tonight, or the last night with something in it).
create or replace function public.my_night_log(p_night timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_cur timestamptz := public.olnu_night_of(now());
  v_night timestamptz;
  v_from timestamptz;
  v_nights jsonb;
  v_items jsonb;
  v_src text;
  v_mn record;
  v_n int; v_first timestamptz; v_last timestamptz; v_bars int; v_kinds jsonb; v_hours jsonb; v_ci int;
begin
  -- nights with something (last 90 days, max 40)
  select coalesce(jsonb_agg(jsonb_build_object('night', x.night, 'evening', public.olnu_evening(x.night), 'drinks', x.drinks, 'log', x.log)
                            order by x.night desc), '[]'::jsonb)
    into v_nights
    from (select n.night, max(n.drinks)::int as drinks, bool_or(n.log) as log from (
            select d.night, count(*) filter (where d.kind <> 'checkin')::int as drinks, true as log
              from public.drink_log d where d.user_id = v_uid and not d.undone and d.night > now() - interval '90 days' group by d.night
            union all
            select m.night, (m.beers + m.others)::int, false from public.medal_nights m
             where m.user_id = v_uid and m.night > now() - interval '90 days' and (m.beers + m.others) > 0
            union all
            select t.night, 0, false from public.crew_tracks t
             where t.user_id = v_uid and t.kind = 'ci' and t.night > now() - interval '90 days' group by t.night
          ) n group by n.night order by n.night desc limit 40) x;

  if p_night is not null then
    v_night := public.olnu_night_of(p_night - interval '1 second');
    if v_night > v_cur then v_night := v_cur; end if;
  elsif exists (select 1 from jsonb_array_elements(v_nights) e where (e.value ->> 'night')::timestamptz = v_cur) then
    v_night := v_cur;
  else
    v_night := coalesce((v_nights -> 0 ->> 'night')::timestamptz, v_cur);
  end if;
  v_from := v_night - interval '24 hours';

  if exists (select 1 from public.drink_log d where d.user_id = v_uid and d.night = v_night) then
    v_src := 'log';
    select coalesce(jsonb_agg(jsonb_build_object('at', d.at, 'kind', d.kind, 'bar', d.bar_name, 'bar_id', d.bar_id, 'area', d.area,
                              'ghost', d.ghost) order by d.at, d.id), '[]'::jsonb)
      into v_items
      from (select * from public.drink_log x where x.user_id = v_uid and x.night = v_night and not x.undone order by x.at, x.id limit 200) d;
  else
    select coalesce(jsonb_agg(z.j order by z.at), '[]'::jsonb) into v_items from (
      select l.at, jsonb_build_object('at', l.at, 'kind', 'unknown', 'bar', null, 'area', null, 'ghost', false) as j
        from public.duel_log l, generate_series(1, least(greatest(l.n, 0), 5))
       where l.user_id = v_uid and l.kind = 'drink' and l.n > 0 and l.at >= v_from and l.at < v_night
      union all
      select t.at, jsonb_build_object('at', t.at, 'kind', 'checkin', 'bar', t.bar_name, 'bar_id', t.bar_id, 'area', null, 'ghost', false)
        from public.crew_tracks t where t.user_id = v_uid and t.kind = 'ci' and t.night = v_night
      order by 1 limit 200) z;
    v_src := case when jsonb_array_length(v_items) > 0 then 'legacy' else 'none' end;
  end if;

  select m.beers, m.others, m.first_at into v_mn from public.medal_nights m where m.user_id = v_uid and m.night = v_night;
  select count(*) filter (where e.value ->> 'kind' <> 'checkin')::int,
         min((e.value ->> 'at')::timestamptz) filter (where e.value ->> 'kind' <> 'checkin'),
         max((e.value ->> 'at')::timestamptz) filter (where e.value ->> 'kind' <> 'checkin'),
         count(distinct coalesce(e.value ->> 'bar_id', e.value ->> 'bar')) filter (where coalesce(e.value ->> 'bar', '') <> '')::int,
         count(*) filter (where e.value ->> 'kind' = 'checkin')::int
    into v_n, v_first, v_last, v_bars, v_ci
    from jsonb_array_elements(v_items) e;
  select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) into v_kinds
    from (select e.value ->> 'kind' as kind, count(*)::int as n from jsonb_array_elements(v_items) e
           where e.value ->> 'kind' not in ('checkin', 'unknown') group by 1) k;
  select coalesce(jsonb_agg(jsonb_build_object('h', h.h, 'n', h.n) order by h.o), '[]'::jsonb) into v_hours
    from (select to_char((e.value ->> 'at')::timestamptz at time zone 'Europe/Stockholm', 'HH24') as h,
                 min((e.value ->> 'at')::timestamptz) as o, count(*)::int as n
            from jsonb_array_elements(v_items) e where e.value ->> 'kind' <> 'checkin' group by 1) h;

  return jsonb_build_object('v', 1, 'now', now(), 'night', v_night, 'evening', public.olnu_evening(v_night),
    'tonight', v_night = v_cur, 'source', v_src, 'items', v_items, 'nights', v_nights,
    'stats', jsonb_build_object(
      'drinks', greatest(coalesce(v_n, 0), coalesce(v_mn.beers + v_mn.others, 0)),
      'logged', coalesce(v_n, 0),
      'beers', coalesce(v_mn.beers, (v_kinds ->> 'beer')::int, 0), 'others', coalesce(v_mn.others, 0),
      'kinds', v_kinds,
      'first_at', coalesce(v_first, v_mn.first_at), 'last_at', v_last,
      'per_hour', case when coalesce(v_n, 0) >= 2 and v_last > v_first
                       then round((v_n / greatest(0.5, extract(epoch from (v_last - v_first)) / 3600.0))::numeric, 1)::float8 end,
      'bars', coalesce(v_bars, 0), 'checkins', coalesce(v_ci, 0), 'hours', v_hours));
end; $$;
revoke all on function public.my_night_log(timestamptz) from public, anon;
grant execute on function public.my_night_log(timestamptz) to authenticated;
revoke all on function public.olnu_dl_bar_name(text) from public, anon, authenticated;
revoke all on function public.olnu_dl_beers_tg() from public, anon, authenticated;
revoke all on function public.olnu_dl_checkin_tg() from public, anon, authenticated;
