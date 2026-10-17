-- 0023 v17: WORLDWIDE posts, ALL DRINKS count, LOCAL TOPPLISTA (opt-in) and WALL OF FAME (additive).
-- Needs 0001–0022. Safe to re-run. No function changes its return type; new fields go at the end of json.
--
-- 1. Worldwide: every position check accepts |lat| <= 85, lng -180..180 (finite). The error code stays
--    'outside_sweden' (now = invalid coordinates). post_beer / post_other keep their old Sweden-only bodies
--    (old apps); post_beer_v2 / post_other_v2 accept the world: a point outside Sweden is posted through the
--    old body at a placeholder point and a BEFORE trigger (olnu_a_world_pos, runs first) puts the real,
--    rounded position on the row before any other trigger sees it.
-- 2. All drinks: week_beers (lifetime, titles, leagues, my_stats, friend totals) counts beers + other drinks;
--    medals use beers + others per night; owner stats get drink totals; notify-group levels use drinks.
--    Backfill: lifetime >= tonight's drinks for every live row; quiet (titles pre-claimed, notified_level set).
-- 3. Topplista + Wall of Fame: board_optin, board_nights, board_bars, board_rl; RPCs set_board_optin,
--    my_board_optin, local_board, wall_of_fame. Names only for users who opted in. Never positions.

-- ---------------------------------------------------------------------------
-- A. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.olnu_world_ok(p_lat float8, p_lng float8)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between -85.0 and 85.0 and p_lng between -180.0 and 180.0;
$$;

create or replace function public.olnu_in_se_box(p_lat float8, p_lng float8)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_lat between 55.0 and 69.1 and p_lng between 10.9 and 24.2;
$$;

-- Level of a drink count (same rule as notify-group milestoneLevel).
create or replace function public.olnu_drink_level(p_n int)
returns int
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_n, 0) >= 10 then 10 when coalesce(p_n, 0) >= 5 then 5
              when coalesce(p_n, 0) >= 1 then 1 else 0 end;
$$;

-- ---------------------------------------------------------------------------
-- B. Worldwide posting through the v2 RPCs
-- ---------------------------------------------------------------------------
-- olnu.world_pos = 'lat,lng' (transaction-local, set only by post_beer_v2 / post_other_v2).
-- The old bodies are called with the placeholder 62.0, 15.0 (exact after both roundings).
create or replace function public.olnu_world_pos_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s   text := coalesce(current_setting('olnu.world_pos', true), '');
  v_lat float8;
  v_lng float8;
begin
  if v_s = '' or new.lat is distinct from 62.0::float8 or new.lng is distinct from 15.0::float8 then
    return new;
  end if;
  v_lat := split_part(v_s, ',', 1)::float8;
  v_lng := split_part(v_s, ',', 2)::float8;
  if not public.olnu_world_ok(v_lat, v_lng) then
    return new;
  end if;
  if new.precise then
    new.lat := round(v_lat::numeric, 5)::float8;
    new.lng := round(v_lng::numeric, 5)::float8;
  else
    new.lat := (round(v_lat::numeric / 0.005) * 0.005)::float8;
    new.lng := (round(v_lng::numeric / 0.01) * 0.01)::float8;
  end if;
  return new;
end; $$;

-- BEFORE triggers fire in name order: olnu_a_world_pos runs before olnu_beer_prev / olnu_beer_snap.
create or replace trigger olnu_a_world_pos
  before insert or update on public.beers
  for each row execute function public.olnu_world_pos_tg();

create or replace function public.post_beer_v2(p_lat double precision, p_lng double precision, p_precise boolean, p_hidden boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_hidden boolean := coalesce(p_hidden, false);
  v_lat    float8 := p_lat;
  v_lng    float8 := p_lng;
  v_r      jsonb;
  v_row    public.beers%rowtype;
  v_drinks int;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if not public.olnu_in_se_box(p_lat, p_lng) then
    perform set_config('olnu.world_pos', p_lat::text || ',' || p_lng::text, true);
    v_lat := 62.0;
    v_lng := 15.0;
  end if;
  if v_hidden then
    perform set_config('olnu.ghost', '1', true);
    v_r := public.post_beer(v_lat, v_lng, false)::jsonb;
    perform set_config('olnu.ghost', '', true);
    perform set_config('olnu.world_pos', '', true);
    if (v_r->>'accepted')::boolean then
      update public.beers set stopped = true, ghost = true
       where id = (v_r->>'id')::bigint and user_id = v_uid;
      -- No beer_events row, so count the beer for the owner page here.
      begin
        insert into public.owner_hours as h (hour, beers) values (date_trunc('hour', now()), 1)
        on conflict (hour) do update set beers = h.beers + 1;
      exception when others then
        null;
      end;
    end if;
  else
    v_r := public.post_beer(v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
  end if;

  select * into v_row from public.beers b where b.id = (v_r->>'id')::bigint;
  v_drinks := coalesce(v_row.beer_count, 0) + coalesce(v_row.other_count, 0);
  return v_r || jsonb_build_object(
    'hidden', coalesce(v_row.stopped, false),
    'undo_until', case when (v_r->>'accepted')::boolean then v_row.beer_at + interval '2 minutes' end,
    'undos_left', greatest(0, 3 - coalesce(v_row.undo_count, 0)),
    'lat', v_row.lat,
    'lng', v_row.lng,
    'drinks', v_drinks,
    'milestone', case when (v_r->>'accepted')::boolean and v_drinks in (1, 5, 10) then v_drinks end);
end;
$$;

create or replace function public.post_other_v2(p_kind text, p_lat double precision, p_lng double precision, p_precise boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_lat    float8 := p_lat;
  v_lng    float8 := p_lng;
  v_r      jsonb;
  v_row    public.beers%rowtype;
  v_drinks int;
begin
  if v_kind not in ('rom', 'vin', 'cider', 'drink', 'shot', 'whisky', 'annat', 'grogg', 'bubbel') then
    raise exception 'invalid_kind';
  end if;
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if not public.olnu_in_se_box(p_lat, p_lng) then
    perform set_config('olnu.world_pos', p_lat::text || ',' || p_lng::text, true);
    v_lat := 62.0;
    v_lng := 15.0;
  end if;
  if v_kind in ('grogg', 'bubbel') then
    v_r := public.post_other('annat', v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
    if (v_r->>'accepted')::boolean then
      update public.beers set other_kind = v_kind where id = (v_r->>'id')::bigint and user_id = v_uid;
      v_r := jsonb_set(v_r, '{other_kind}', to_jsonb(v_kind));
    end if;
  else
    v_r := public.post_other(v_kind, v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
  end if;
  select * into v_row from public.beers b where b.id = (v_r->>'id')::bigint;
  v_drinks := coalesce(v_row.beer_count, 0) + coalesce(v_row.other_count, 0);
  return (v_r || jsonb_build_object(
    'lat', v_row.lat,
    'lng', v_row.lng,
    'drinks', v_drinks,
    'milestone', case when (v_r->>'accepted')::boolean and v_drinks in (1, 5, 10) then v_drinks end))::json;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Same bodies as before with world bounds (check_in, record_bar, set_push_location, create_rally,
--    olnu_bp_in_sweden (queue/offer/beer_type_stats), olnu_g_crawl, olnu_g_guess, poll_v2) and
--    all-drinks counting (olnu_week_beers_tg, olnu_medal_beers_tg, olnu_medal_eval, award_medals,
--    claim_medevac). Generated from the live definitions; only the bounds / counts changed.
-- ---------------------------------------------------------------------------
-- The week trigger now also fires on other drinks (it fired on beer_count only).
create or replace trigger olnu_week_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_week_beers_tg();

-- set_push_location
create or replace function public.set_push_location(p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < -85.0 or p_lat > 85.0 or p_lng < -180.0 or p_lng > 180.0 then
    return;
  end if;
  update public.push_subscriptions
     set lat = round(p_lat::numeric, 2)::float8,
         lng = round(p_lng::numeric, 2)::float8,
         loc_at = now()
   where user_id = v_uid;
end;
$function$;

-- check_in
create or replace function public.check_in(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := btrim(regexp_replace(coalesce(p_bar_id, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_bar_name, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
  v_row  public.checkins%rowtype;
  v_cool constant interval := interval '2 minutes';
begin
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < -85.0 or p_lat > 85.0 or p_lng < -180.0 or p_lng > 180.0 then
    raise exception 'outside_sweden';
  end if;
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_bar';
  end if;

  -- Serialize per user so two fast calls cannot both pass the rate limit.
  perform pg_advisory_xact_lock(hashtextextended('olnu_checkin:' || v_uid::text, 0));
  select * into v_row from public.checkins c where c.user_id = v_uid;
  if found and v_row.created_at > now() - v_cool then
    return jsonb_build_object('ok', false,
      'bar_name', case when v_row.expires_at > now() then v_row.bar_name else null end,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_row.created_at + v_cool - now())))::int));
  end if;

  insert into public.checkins (user_id, bar_id, bar_name, lat, lng, created_at, expires_at)
  values (v_uid, v_id, v_name, round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8,
          now(), public.olnu_next_expiry())
  on conflict (user_id) do update
     set bar_id = excluded.bar_id, bar_name = excluded.bar_name, lat = excluded.lat, lng = excluded.lng,
         created_at = excluded.created_at, expires_at = excluded.expires_at;

  return jsonb_build_object('ok', true, 'bar_name', v_name, 'wait_seconds', 0);
end;
$function$;

-- record_bar
create or replace function public.record_bar(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := btrim(coalesce(p_bar_id, ''));
  v_name text := left(btrim(regexp_replace(coalesce(p_bar_name, ''), '[[:cntrl:]]', ' ', 'g')), 80);
  v_ok   boolean;
begin
  if char_length(v_id) < 1 or char_length(v_id) > 64
     or p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < -85.0 or p_lat > 85.0 or p_lng < -180.0 or p_lng > 180.0 then
    return;
  end if;

  select exists (
    select 1 from public.beers b
     where b.user_id = v_uid
       and b.expires_at > now()
       and not b.stopped
       and b.precise
       and b.beer_count > 0
       and coalesce(b.beer_at, b.updated_at) > now() - interval '3 minutes'
       and public.olnu_dist_m(b.lat, b.lng, p_lat, p_lng) <= 150
  ) into v_ok;
  if not v_ok then
    return;
  end if;

  insert into public.bar_taps (user_id, bar_id, week, n, bar_name, lat, lng, last_at)
  values (v_uid, v_id, public.olnu_week_start(now()), 1, nullif(v_name, ''),
          round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8, now())
  on conflict (user_id, bar_id, week) do update
     set n = public.bar_taps.n + 1,
         last_at = now(),
         bar_name = coalesce(excluded.bar_name, public.bar_taps.bar_name),
         lat = excluded.lat,
         lng = excluded.lng
   where public.bar_taps.last_at <= now() - interval '9 minutes';
end;
$function$;

-- create_rally
create or replace function public.create_rally(p_group_id uuid, p_body text, p_place text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_body  text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_place text := btrim(regexp_replace(coalesce(p_place, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_lat   float8;
  v_lng   float8;
  v_id    bigint;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_body = '' then
    v_body := 'Behöver förstärkning!';
  end if;
  if char_length(v_body) > 100 or char_length(v_place) > 60 then
    raise exception 'invalid_msg';
  end if;
  if p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between -85.0 and 85.0 and p_lng between -180.0 and 180.0 then
    v_lat := round(p_lat::numeric, 5)::float8;
    v_lng := round(p_lng::numeric, 5)::float8;
  end if;

  -- Serialize per user so two fast calls cannot both pass the rate limit.
  perform pg_advisory_xact_lock(hashtextextended('olnu_rally:' || v_uid::text, 0));
  if exists (select 1 from public.rallies r
              where r.user_id = v_uid and r.created_at > now() - interval '3 minutes') then
    raise exception 'slow_down';
  end if;

  update public.rallies set closed = true
   where user_id = v_uid and group_id = p_group_id and not closed;

  insert into public.rallies (group_id, user_id, body, place, lat, lng, expires_at)
  values (p_group_id, v_uid, v_body, nullif(v_place, ''), v_lat, v_lng, public.olnu_next_expiry())
  returning rallies.id into v_id;

  insert into public.rally_answers (rally_id, user_id, answer, notified)
  values (v_id, v_uid, 'yes', true)
  on conflict (rally_id, user_id) do update set answer = 'yes', updated_at = now(), notified = true;

  return json_build_object('id', v_id);
end;
$function$;

-- olnu_bp_in_sweden
create or replace function public.olnu_bp_in_sweden(p_lat double precision, p_lng double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between -85.0 and 85.0 and p_lng between -180.0 and 180.0;
$function$;

-- olnu_g_crawl
create or replace function public.olnu_g_crawl(p_uid uuid, p_group uuid, p_stops jsonb, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_stops jsonb;
  v_n int; v_ids int; v_bad int;
  v_id bigint;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) not between 2 and 6 then
    raise exception 'invalid_crawl';
  end if;
  begin
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'lat', round(x.lat::numeric, 5)::float8,
             'lng', round(x.lng::numeric, 5)::float8) order by x.ord),
           count(*), count(distinct x.id),
           count(*) filter (where x.id is null or char_length(x.id) not between 1 and 80
                              or x.name is null or char_length(x.name) not between 1 and 60
                              or x.lat is null or x.lng is null
                              or x.lat not between -85.0 and 85.0 or x.lng not between -180.0 and 180.0)
      into v_stops, v_n, v_ids, v_bad
      from (select e.ord,
                   btrim(e.v->>'id') as id,
                   btrim(regexp_replace(regexp_replace(coalesce(e.v->>'name', ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')) as name,
                   (e.v->>'lat')::float8 as lat, (e.v->>'lng')::float8 as lng
              from jsonb_array_elements(p_stops) with ordinality e(v, ord)) x;
  exception when others then
    raise exception 'invalid_crawl';
  end;
  if v_bad > 0 or v_ids <> v_n then
    raise exception 'invalid_crawl';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  if exists (select 1 from public.game_crawls c where c.user_id = p_uid and c.created_at > p_now - interval '2 minutes'
                                                  and c.created_at <= p_now) then
    raise exception 'slow_down';
  end if;
  update public.game_crawls c set closed = true where c.group_id = p_group and c.night = v_night and not c.closed;
  insert into public.game_crawls (group_id, user_id, night, stops, n, created_at)
  values (p_group, p_uid, v_night, v_stops, v_n, p_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'n', v_n);
end;
$function$;

-- olnu_g_guess
create or replace function public.olnu_g_guess(p_uid uuid, p_guess integer, p_town text, p_lat double precision, p_lng double precision, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_close timestamptz := (public.olnu_evening(public.olnu_night_of(p_now))::timestamp + interval '21 hours') at time zone 'Europe/Stockholm';
  v_town  text := left(btrim(regexp_replace(regexp_replace(coalesce(p_town, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), 40);
  v_ch    int;
begin
  if p_now >= v_close then
    raise exception 'too_late';
  end if;
  if p_guess is null or p_guess not between 0 and 20000 then
    raise exception 'invalid_guess';
  end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng
     or p_lat not between -85.0 and 85.0 or p_lng not between -180.0 and 180.0 then
    raise exception 'outside_sweden';
  end if;
  if v_town = '' then v_town := 'Närområdet'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select g.changes into v_ch from public.game_guesses g where g.user_id = p_uid and g.night = v_night;
  if coalesce(v_ch, 0) >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.game_guesses as g (user_id, night, guess, town, lat, lng, created_at, updated_at)
  values (p_uid, v_night, p_guess, v_town, round(p_lat::numeric, 2)::float8, round(p_lng::numeric, 2)::float8, p_now, p_now)
  on conflict (user_id, night) do update
     set guess = excluded.guess, town = excluded.town, lat = excluded.lat, lng = excluded.lng,
         updated_at = excluded.updated_at, changes = g.changes + 1;
  return jsonb_build_object('ok', true, 'guess', p_guess, 'town', v_town, 'closes_at', v_close);
end;
$function$;

-- poll_v2
create or replace function public.poll_v2(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_heat boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := public.olnu_uid();
  v_cap     constant int := 1500;
  v_a       float8; v_b float8; v_c float8; v_d float8;   -- min lat, min lng, max lat, max lng (+ margin)
  v_clat    float8; v_clng float8; v_cos float8;
  v_mlat    float8; v_mlng float8;
  v_pins    json;
  v_n_str   int;
  v_me      jsonb;
  v_row     public.beers%rowtype;
  v_out     json;
  v_bucket  bigint := floor(extract(epoch from now()) / 600)::bigint;
begin
  if p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
     or 'NaN'::float8 in (p_min_lat, p_min_lng, p_max_lat, p_max_lng)
     or abs(p_min_lat) = 'Infinity'::float8 or abs(p_max_lat) = 'Infinity'::float8
     or abs(p_min_lng) = 'Infinity'::float8 or abs(p_max_lng) = 'Infinity'::float8 then
    raise exception 'invalid_bbox';
  end if;
  v_a := least(p_min_lat, p_max_lat);  v_c := greatest(p_min_lat, p_max_lat);
  v_b := least(p_min_lng, p_max_lng);  v_d := greatest(p_min_lng, p_max_lng);
  -- v17: worldwide. A box across the date line (min lng > max lng) = the whole lng range.
  if p_min_lng > p_max_lng and p_min_lng <= 180 and p_max_lng >= -180 then
    v_b := -180;  v_d := 180;
  end if;
  -- 15 % margin on each side (at least ~550 m), then clamp to the world (|lat| <= 85).
  v_mlat := greatest((v_c - v_a) * 0.15, 0.005);
  v_mlng := greatest((v_d - v_b) * 0.15, 0.01);
  v_a := greatest(-85.0, v_a - v_mlat);  v_c := least(85.0, v_c + v_mlat);
  v_b := v_b - v_mlng;  v_d := v_d + v_mlng;
  if v_b < -180 or v_d > 180 then v_b := -180;  v_d := 180; end if;
  if v_a > v_c or v_b > v_d then
    -- Empty box: only the caller and group-mates.
    v_a := 0; v_c := 0; v_b := 0; v_d := 0;
  end if;
  v_clat := (v_a + v_c) / 2;  v_clng := (v_b + v_d) / 2;  v_cos := cos(radians(v_clat));

  with p as (
    select * from public.olnu_pins(v_uid, v_a, v_b, v_c, v_d)
  ),
  ranked as (
    select p.*,
           row_number() over (partition by (p.is_mine or p.is_friend)
                              order by power(p.lat - v_clat, 2) + power((p.lng - v_clng) * v_cos, 2), p.pin_id) as rn,
           count(*) filter (where not (p.is_mine or p.is_friend)) over () as nstr
      from p
  ),
  sel as (
    select * from ranked r where r.is_mine or r.is_friend or r.rn <= v_cap
  ),
  sk as (
    select s.beer_id as sid, count(*)::int as n, bool_or(s.user_id = v_uid) as mine
      from public.skals s join sel on sel.beer_id = s.beer_id
     group by s.beer_id
  ),
  rx1 as (
    select r.beer_id as rid, r.emoji, count(*)::int as n, bool_or(r.user_id = v_uid) as mine
      from public.reactions r join sel on sel.beer_id = r.beer_id
     where r.active
     group by r.beer_id, r.emoji
  ),
  rx as (
    select rx1.rid, jsonb_object_agg(rx1.emoji, rx1.n) as counts,
           coalesce(jsonb_agg(rx1.emoji order by rx1.emoji) filter (where rx1.mine), '[]'::jsonb) as mine
      from rx1 group by rx1.rid
  )
  -- Compact rows: null, false, 0 and empty values are left out (clients treat a missing field as empty).
  select coalesce(json_agg(json_strip_nulls(json_build_object(
           'id',          case when sel.is_mine or sel.is_friend then to_json(sel.beer_id) else to_json(sel.pin_id) end,
           'lat',         sel.lat,
           'lng',         sel.lng,
           'snap',        sel.snap,
           'bar_id',      sel.bar_id,
           'precise',     sel.precise,
           'beer_count',  sel.beer_count,
           'other_count', nullif(sel.other_count, 0),
           'other_kind',  case when sel.other_count > 0 then sel.other_kind end,
           'created_at',  sel.created_at,
           'is_mine',     case when sel.is_mine then true end,
           'is_friend',   case when sel.is_friend then true end,
           'friend_name', case when sel.is_mine then null else sel.friend_name end,
           'skal_count',  sk.n,
           'i_skaled',    case when sk.mine then true end,
           'rx',          rx.counts,
           'my_rx',       case when rx.mine <> '[]'::jsonb then rx.mine end,
           'total',       case when sel.is_mine or sel.is_friend then public.olnu_lifetime(
                            (select b.user_id from public.beers b where b.id = sel.beer_id)) end
         )) order by sel.created_at, sel.pin_id), '[]'::json),
         coalesce(max(sel.nstr), 0)
    into v_pins, v_n_str
    from sel
    left join sk on sk.sid = sel.beer_id
    left join rx on rx.rid = sel.beer_id;

  select * into v_row from public.beers b where b.user_id = v_uid and b.expires_at > now();
  v_me := public.my_stats()::jsonb || jsonb_build_object(
    'id',           v_row.id,
    'beer_count',   coalesce(v_row.beer_count, 0),
    'other_count',  coalesce(v_row.other_count, 0),
    'other_kind',   v_row.other_kind,
    'lat',          v_row.lat,
    'lng',          v_row.lng,
    'precise',      v_row.precise,
    'hidden',       coalesce(v_row.stopped, false),
    'ghost',        coalesce(v_row.ghost, false),
    'expires_at',   v_row.expires_at,
    'beer_at',      v_row.beer_at,
    'wait_seconds', case when v_row.beer_count > 0 and v_row.beer_at > now() - interval '10 minutes'
                         then greatest(1, ceil(extract(epoch from (v_row.beer_at + interval '10 minutes' - now())))::int)
                         else 0 end,
    'undo_until',   case when v_row.beer_count > 0 and coalesce(v_row.undo_count, 0) < 3
                          and v_row.beer_at > now() - interval '2 minutes'
                          and (v_row.prev_for = v_row.beer_count or v_row.beer_count = 1)
                         then v_row.beer_at + interval '2 minutes' end,
    'undos_left',   greatest(0, 3 - coalesce(v_row.undo_count, 0)));

  v_out := json_build_object(
    'v',            1,
    'server_time',  now(),
    'full',         true,
    'ids_until',    to_timestamp((v_bucket + 1) * 600),
    'bbox',         json_build_array(v_a, v_b, v_c, v_d),
    'pins',         v_pins,
    'capped',       v_n_str > v_cap,
    'pins_in_view', v_n_str,
    'live_total',   (select count(*)::int from public.beers b
                      where b.expires_at > now() and not b.stopped
                        and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)),
    'me',           v_me::json,
    'checkins',     (select coalesce(json_agg(json_build_object(
                        'bar_id', c.bar_id, 'bar_name', c.bar_name, 'lat', c.lat, 'lng', c.lng,
                        'name', case when c.user_id = v_uid
                                     then (select min(mm.display_name) from public.group_members mm where mm.user_id = v_uid)
                                     else f.fname end,
                        'is_mine', c.user_id = v_uid,
                        'is_friend', c.user_id <> v_uid and f.fname is not null,
                        'created_at', case when c.user_id = v_uid or f.fname is not null then c.created_at
                                           else to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900) end
                      ) order by c.created_at), '[]'::json)
                       from (select * from public.checkins c0
                              where c0.expires_at > now()
                              order by c0.created_at limit 2000) c
                       left join lateral (
                         select min(am.display_name) as fname
                           from public.group_members am
                           join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
                          where am.user_id = c.user_id and c.user_id <> v_uid
                       ) f on true
                      where c.user_id = v_uid or f.fname is not null
                         or (c.lat between v_a and v_c and c.lng between v_b and v_d)),
    'rallies',      (select coalesce(json_agg(to_json(r) order by r.created_at desc, r.id desc), '[]'::json)
                       from public.olnu_rally_rows(v_uid, null) r),
    'heat',         case when coalesce(p_heat, false) then
                      (select coalesce(json_agg(json_build_array(h.lat, h.lng, h.w)), '[]'::json)
                         from public.olnu_heat(v_a - (v_c - v_a) * 0.5, v_b - (v_d - v_b) * 0.5,
                                               v_c + (v_c - v_a) * 0.5, v_d + (v_d - v_b) * 0.5, 3000) h)
                    end
  );
  return v_out;
end;
$function$;

-- olnu_medal_eval
create or replace function public.olnu_medal_eval(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total int := public.olnu_lifetime(p_uid);
  v_nights int; v_bars int; v_rounds int; v_regular int;
  v_sg int := 0; v_sr int := 0; v_msgs int := 0;
  v_yes int; v_rallies int; v_home int; v_day int; v_owl int; v_tue int;
  v_first int; v_king int; v_league int; v_cells int; v_side int; v_hot int; v_med int;
  v_valb int; v_mids int; v_luc int; v_nyar int; v_group int; v_comp int;
  v_week date := public.olnu_week_start(now());
begin
  select count(*) filter (where (mn.beers + mn.others) >= 1),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.home),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.early),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.owl),
         count(*) filter (where (mn.beers + mn.others) >= 1 and extract(isodow from public.olnu_evening(mn.night)) = 2),
         count(*) filter (where mn.others >= 1),
         count(*) filter (where (mn.beers + mn.others) >= 5),
         count(*) filter (where (mn.beers + mn.others) >= 10),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '04-30'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') between '06-19' and '06-25'
                   and extract(isodow from public.olnu_evening(mn.night)) = 5),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-13'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-31'),
         count(distinct mn.cell) filter (where (mn.beers + mn.others) >= 1)
    into v_nights, v_home, v_day, v_owl, v_tue, v_side, v_hot, v_med, v_valb, v_mids, v_luc, v_nyar, v_cells
    from public.medal_nights mn where mn.user_id = p_uid;

  select count(distinct c.bar_id) into v_bars from public.medal_checkins c where c.user_id = p_uid;
  select count(*) into v_rounds from (
    select c.night from public.medal_checkins c where c.user_id = p_uid group by c.night having count(*) >= 3) x;
  select count(*) into v_regular from (
    select c.bar_id from public.medal_checkins c where c.user_id = p_uid group by c.bar_id having count(*) >= 5) x;

  select coalesce(mc.skal_given, 0), coalesce(mc.skal_got, 0), coalesce(mc.msgs, 0)
    into v_sg, v_sr, v_msgs from public.medal_counts mc where mc.user_id = p_uid;
  v_sg := coalesce(v_sg, 0); v_sr := coalesce(v_sr, 0); v_msgs := coalesce(v_msgs, 0);

  select count(*) into v_yes from public.rally_answers a join public.rallies r on r.id = a.rally_id
   where a.user_id = p_uid and a.answer = 'yes' and r.user_id <> p_uid;
  select count(*) into v_rallies from public.rallies r where r.user_id = p_uid;

  -- Förtruppen: first of the group out on a night where at least one group-mate was out too.
  select count(*) into v_first
    from public.medal_nights mn
   where mn.user_id = p_uid and (mn.beers + mn.others) >= 1 and mn.first_at is not null
     and exists (select 1 from public.medal_nights o
                  where o.night = mn.night and (o.beers + o.others) >= 1 and o.user_id <> p_uid
                    and o.user_id in (select am.user_id from public.group_members am
                                        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid))
     and not exists (select 1 from public.medal_nights o
                      where o.night = mn.night and (o.beers + o.others) >= 1 and o.user_id <> p_uid and o.first_at < mn.first_at
                        and o.user_id in (select am.user_id from public.group_members am
                                            join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid));

  -- Barkung: king of a bar in a week (same rule as bar_kings).
  select count(*) into v_king from (
    select t.user_id, row_number() over (partition by t.bar_id, t.week order by t.n desc, t.last_at asc, t.user_id) as rn
      from public.bar_taps t
     where t.n > 0 and t.bar_id in (select x.bar_id from public.bar_taps x where x.user_id = p_uid)
  ) k where k.rn = 1 and k.user_id = p_uid;

  -- Ligamästare: one of my groups was number 1 in a finished week (last 26 weeks, current members).
  select count(*) into v_league from (
    select distinct on (s.wk) s.wk, s.gid
      from (select wb.week as wk, gm.group_id as gid, sum(wb.n) as tot, g.created_at as gat
              from public.week_beers wb
              join public.group_members gm on gm.user_id = wb.user_id
              join public.groups g on g.id = gm.group_id
             where wb.week < v_week and wb.week >= v_week - 182
               and gm.group_id in (select x.group_id from public.group_members x group by x.group_id having count(*) >= 2)
             group by wb.week, gm.group_id, g.created_at) s
     where s.tot > 0
     order by s.wk, s.tot desc, s.gat asc, s.gid
  ) top
   where top.gid in (select m.group_id from public.group_members m where m.user_id = p_uid);

  select count(*) into v_group from public.group_members m where m.user_id = p_uid;
  select count(*) into v_comp from public.groups g
   where g.created_by = p_uid
     and (select count(*) from public.group_members m where m.group_id = g.id) >= 5;

  return query
  select v.medal, v.n from (values
    ('m1', case when v_total >= 1 then 1 else 0 end),
    ('m10', case when v_total >= 10 then 1 else 0 end),
    ('m50', case when v_total >= 50 then 1 else 0 end),
    ('m100', case when v_total >= 100 then 1 else 0 end),
    ('m250', case when v_total >= 250 then 1 else 0 end),
    ('m500', case when v_total >= 500 then 1 else 0 end),
    ('m1000', case when v_total >= 1000 then 1 else 0 end),
    ('n5', case when v_nights >= 5 then 1 else 0 end),
    ('n25', case when v_nights >= 25 then 1 else 0 end),
    ('n100', case when v_nights >= 100 then 1 else 0 end),
    ('b5', case when v_bars >= 5 then 1 else 0 end),
    ('b15', case when v_bars >= 15 then 1 else 0 end),
    ('b40', case when v_bars >= 40 then 1 else 0 end),
    ('krogrunda', v_rounds),
    ('stammis', v_regular),
    ('sg10', case when v_sg >= 10 then 1 else 0 end),
    ('sg100', case when v_sg >= 100 then 1 else 0 end),
    ('sr10', case when v_sr >= 10 then 1 else 0 end),
    ('sr100', case when v_sr >= 100 then 1 else 0 end),
    ('inryckt', case when v_yes >= 1 then 1 else 0 end),
    ('alltid', case when v_yes >= 10 then 1 else 0 end),
    ('trumslag', case when v_rallies >= 1 then 1 else 0 end),
    ('hemvarn', v_home),
    ('komhem', case when v_home >= 5 then v_home / 5 else 0 end),
    ('dagsljus', v_day),
    ('uggla', v_owl),
    ('tisdag', v_tue),
    ('fortrupp', v_first),
    ('kung', v_king),
    ('liga', v_league),
    ('pluton', case when v_group >= 1 then 1 else 0 end),
    ('kompani', v_comp),
    ('radio', case when v_msgs >= 1 then 1 else 0 end),
    ('signal', case when v_msgs >= 50 then 1 else 0 end),
    ('valborg', v_valb),
    ('midsommar', v_mids),
    ('lucia', v_luc),
    ('nyar', v_nyar),
    ('faltresa', greatest(0, v_cells - 1)),
    ('sidospar', v_side),
    ('het', v_hot),
    ('medevac', v_med)
  ) as v(medal, n)
  union all
  select c.medal, count(*)::int from public.medal_claims c where c.user_id = p_uid group by c.medal;
end;
$function$;

-- award_medals
create or replace function public.award_medals(p_event text DEFAULT NULL::text)
 RETURNS TABLE(medal text, count integer, is_new boolean, earned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  if lower(btrim(coalesce(p_event, ''))) = 'home' then
    update public.medal_nights mn set home = true
      from public.beers b
     where b.user_id = v_uid and b.expires_at > now() and (b.beer_count + coalesce(b.other_count, 0)) >= 1
       and mn.user_id = v_uid and mn.night = b.expires_at;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$function$;

-- claim_medevac
create or replace function public.claim_medevac(p_beer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_b   record;
  v_row public.medevac_checks;
begin
  select b.user_id, b.expires_at, b.beer_count + coalesce(b.other_count, 0) as beer_count into v_b from public.beers b
   where b.id = p_beer_id and b.expires_at > now();
  if not found or coalesce(v_b.beer_count, 0) < 10 then
    raise exception 'beer_not_found';
  end if;
  if v_b.user_id = v_uid then
    raise exception 'own_beer';
  end if;
  if not public.olnu_shares_group(v_uid, v_b.user_id) then
    raise exception 'not_friend';
  end if;
  insert into public.medevac_checks (target, night, checker)
  values (v_b.user_id, v_b.expires_at, v_uid)
  on conflict (target, night) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('ok', true, 'mine', true, 'id', v_row.id, 'checker', public.olnu_name_for(v_uid, v_uid));
  end if;
  select * into v_row from public.medevac_checks c where c.target = v_b.user_id and c.night = v_b.expires_at;
  return jsonb_build_object('ok', false, 'mine', v_row.checker = v_uid, 'id', v_row.id,
    'checker', public.olnu_name_for(v_uid, v_row.checker));
end;
$function$;

-- olnu_medal_beers_tg
create or replace function public.olnu_medal_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ob int := 0;
  v_oo int := 0;
  v_h  int := extract(hour from (now() at time zone 'Europe/Stockholm'))::int;
begin
  begin
    if tg_op = 'UPDATE' then
      v_ob := coalesce(old.beer_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if coalesce(new.beer_count, 0) > v_ob then
      insert into public.medal_nights as m (user_id, night, beers, first_at, early, owl, cell)
      values (new.user_id, new.expires_at, new.beer_count, now(),
              v_h >= 5 and v_h < 16, v_h >= 1 and v_h < 5, public.olnu_cell(new.lat, new.lng))
      on conflict (user_id, night) do update
         set beers = greatest(m.beers, excluded.beers),
             first_at = coalesce(m.first_at, excluded.first_at),
             early = m.early or excluded.early,
             owl = m.owl or excluded.owl,
             cell = coalesce(m.cell, excluded.cell);
    end if;
    if coalesce(new.other_count, 0) > v_oo then
      -- v17: other drinks start a night too (first_at, early, owl, cell).
      insert into public.medal_nights as m (user_id, night, others, first_at, early, owl, cell)
      values (new.user_id, new.expires_at, new.other_count, now(),
              v_h >= 5 and v_h < 16, v_h >= 1 and v_h < 5, public.olnu_cell(new.lat, new.lng))
      on conflict (user_id, night) do update
         set others = greatest(m.others, excluded.others),
             first_at = coalesce(m.first_at, excluded.first_at),
             early = m.early or excluded.early,
             owl = m.owl or excluded.owl,
             cell = coalesce(m.cell, excluded.cell);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;

-- olnu_week_beers_tg
create or replace function public.olnu_week_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inc int;
begin
  if tg_op = 'INSERT' then
    v_inc := coalesce(new.beer_count, 0) + coalesce(new.other_count, 0);
  else
    v_inc := (coalesce(new.beer_count, 0) + coalesce(new.other_count, 0))
           - (coalesce(old.beer_count, 0) + coalesce(old.other_count, 0));
  end if;
  if v_inc > 0 then
    insert into public.week_beers (user_id, week, n)
    values (new.user_id, public.olnu_week_start(now()), v_inc)
    on conflict (user_id, week) do update set n = public.week_beers.n + excluded.n;
  end if;
  return new;
end; $function$;

-- ---------------------------------------------------------------------------
-- D. Owner stats: drink totals (beers + other drinks). Same keys as before plus new keys at the end of
--    each object: per night 'drinks'; beers 'drinks_tonight', 'drinks_last_night'. hot/medevac use drinks.
-- ---------------------------------------------------------------------------
create or replace function public.owner_stats(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now       timestamptz := now();
  v_tz        text := 'Europe/Stockholm';
  v_next      timestamptz := public.olnu_next_expiry();
  v_next_loc  timestamp := public.olnu_next_expiry() at time zone 'Europe/Stockholm';
  v_first     timestamptz;
  v_today     timestamptz := date_trunc('day', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm';
  v_medals    boolean := to_regclass('public.medal_nights') is not null;
  v_mcheck    boolean := to_regclass('public.medal_checkins') is not null;
  v_users     jsonb;
  v_beers     jsonb;
  v_places    jsonb;
  v_social    jsonb;
  v_care      jsonb;
  v_tech      jsonb := '{}'::jsonb;
  v_nights    jsonb;
  v_hours     jsonb;
  v_n         bigint;
  r           record;
begin
  if (select count(*) from public.owner_key_fails f where f.at > v_now - interval '1 hour') > 20 then
    raise exception 'rate_limited';
  end if;

  if p_key is null or char_length(p_key) > 200 or not exists (
       select 1 from public.owner_keys k
        where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    insert into public.owner_key_fails (at) values (v_now);
    perform set_config('response.status', '403', true);
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;

  v_first := (v_next_loc - interval '29 days') at time zone v_tz;

  select coalesce(jsonb_agg(jsonb_build_object(
           'night', to_char(((g.night at time zone v_tz) - interval '6 hours')::date, 'YYYY-MM-DD'),
           'beers', greatest(coalesce(u.b, 0), coalesce(e.b, 0)),
           'others', coalesce(u.o, 0),
           'people', coalesce(u.p, 0),
           'hot', greatest(coalesce(u.hot, 0), coalesce(e.hot, 0)),
           'medevac', greatest(coalesce(u.med, 0), coalesce(e.med, 0)),
           'home', coalesce(u.home, 0),
           'drinks', greatest(coalesce(u.b, 0), coalesce(e.b, 0)) + coalesce(u.o, 0)
         ) order by g.night), '[]'::jsonb)
    into v_nights
    from (select (v_next_loc - make_interval(days => k)) at time zone v_tz as night
            from generate_series(0, 29) k) g
    left join (select night, sum(b)::int b, sum(o)::int o,
                      count(*) filter (where b > 0 or o > 0)::int p,
                      count(*) filter (where b + o >= 5 and b + o < 10)::int hot,
                      count(*) filter (where b + o >= 10)::int med,
                      count(*) filter (where home)::int home
                 from public.olnu_owner_un(v_first) group by night) u on u.night = g.night
    left join (select expires_at night, count(*)::int b,
                      count(*) filter (where n = 5)::int hot,
                      count(*) filter (where n = 10)::int med
                 from public.beer_events where kind = 'beer' and expires_at >= v_first
                group by 1) e on e.night = g.night;

  select jsonb_build_object(
    'total', (select count(*) from auth.users),
    'named', (select count(distinct user_id) from public.group_members),
    'new_today', (select count(*) from auth.users where created_at >= v_today),
    'new_7d', (select count(*) from auth.users where created_at > v_now - interval '7 days'),
    'new_30d', (select count(*) from auth.users where created_at > v_now - interval '30 days'),
    'active_tonight', (select count(distinct uid) from (
        select user_id uid from public.beers
         where expires_at = v_next and (coalesce(beer_count, 0) + coalesce(other_count, 0) + coalesce(shot_count, 0)) > 0
        union all
        select user_id from public.checkins where expires_at = v_next) a),
    'out_now', (select count(*) from public.beers where expires_at > v_now and not coalesce(stopped, false)),
    'active_7d', (select count(distinct uid) from (
        select user_id uid from public.olnu_owner_un(v_first) where night > v_now - interval '7 days' and (b > 0 or o > 0)
        union all select user_id from public.checkins where created_at > v_now - interval '7 days'
        union all select user_id from public.group_msgs where created_at > v_now - interval '7 days'
        union all select user_id from public.skals where created_at > v_now - interval '7 days'
        union all select user_id from public.reactions where updated_at > v_now - interval '7 days'
        union all select user_id from public.rally_answers where updated_at > v_now - interval '7 days') a),
    'opened_7d', (select count(distinct user_id) from auth.sessions where updated_at > v_now - interval '7 days'),
    'push', (select count(distinct user_id) from public.push_subscriptions)
  ) into v_users;

  -- owner_hours counts every drink from v17 (beers via beer_events, other drinks via olnu_board_beers_tg).
  select coalesce(jsonb_agg(coalesce(h.n, 0) order by g.hr), '[]'::jsonb) into v_hours
    from generate_series(0, 23) g(hr)
    left join (select extract(hour from (hour at time zone v_tz))::int hr, sum(beers)::int n
                 from public.owner_hours where hour > v_now - interval '30 days' group by 1) h on h.hr = g.hr;

  select jsonb_build_object(
    'tonight', (v_nights -> 29 ->> 'beers')::int,
    'others_tonight', (v_nights -> 29 ->> 'others')::int,
    'last_night', (v_nights -> 28 ->> 'beers')::int,
    'per_night', v_nights,
    'all_time', greatest(
        (select coalesce(sum(n), 0) from public.week_beers),
        (select count(*) from public.beer_events where kind = 'beer'),
        case when v_medals then (select coalesce(sum(beers + others), 0) from public.medal_nights) else 0 end),
    'avg_per_person', (select round(avg(b + o)::numeric, 2) from public.olnu_owner_un(v_first) where b + o > 0),
    'peak_hours', v_hours,
    'drinks_tonight', (v_nights -> 29 ->> 'drinks')::int,
    'drinks_last_night', (v_nights -> 28 ->> 'drinks')::int
  ) into v_beers;

  select jsonb_build_object(
    'top_bars', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'beers', t.beers, 'checkins', t.ch)
                          order by t.beers desc, t.ch desc, t.name), '[]'::jsonb)
                   from (select coalesce(bt.name, ck.name) as name, coalesce(bt.n, 0) beers, coalesce(ck.n, 0) ch
                           from (select bar_id, max(bar_name) name, sum(n)::int n from public.bar_taps
                                  where week >= public.olnu_week_start(v_now - interval '30 days') group by bar_id) bt
                           full join (select bar_id, max(bar_name) name, count(*)::int n from public.checkins
                                       where created_at > v_now - interval '30 days' group by bar_id) ck
                             on ck.bar_id = bt.bar_id
                          order by 2 desc, 3 desc, 1
                          limit 10) t),
    'checkins_tonight', (select count(*) from public.checkins where expires_at = v_next),
    'checkins_30d', case when v_mcheck
        then (select count(*) from public.medal_checkins where night >= v_first)
        else (select count(*) from public.checkins where created_at > v_now - interval '30 days') end,
    'checkin_users_30d', (select count(*) from public.checkins where created_at > v_now - interval '30 days')
  ) into v_places;

  select jsonb_build_object(
    'groups', (select count(*) from public.groups),
    'groups_2plus', (select count(*) from (select group_id from public.group_members group by 1 having count(*) >= 2) g),
    'avg_group_size', (select round(avg(c)::numeric, 1) from (select count(*) c from public.group_members group by group_id) g),
    'msgs_7d', (select count(*) from public.group_msgs where created_at > v_now - interval '7 days'),
    'skal_7d', (select count(*) from public.skals where created_at > v_now - interval '7 days'),
    'rallies_7d', (select count(*) from public.rallies where created_at > v_now - interval '7 days'),
    'reactions_7d', (select count(*) from public.reactions where created_at > v_now - interval '7 days')
  ) into v_social;

  select jsonb_build_object(
    'hot_tonight', (select count(*) from public.beers where expires_at = v_next
                       and beer_count + coalesce(other_count, 0) >= 5 and beer_count + coalesce(other_count, 0) < 10),
    'medevac_tonight', (select count(*) from public.beers where expires_at = v_next
                           and beer_count + coalesce(other_count, 0) >= 10),
    'home_7d', (select coalesce(sum((x ->> 'home')::int), 0)
                  from jsonb_array_elements(v_nights) with ordinality as a(x, i) where a.i > 23),
    'home_tracked', v_medals
  ) into v_care;

  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select count(*) from public.%I', r.tablename) into v_n;
    v_tech := v_tech || jsonb_build_object(r.tablename, v_n);
  end loop;
  v_tech := v_tech || jsonb_build_object('auth.users', (select count(*) from auth.users));

  return jsonb_build_object(
    'generated_at', v_now,
    'night_ends', v_next,
    'users', v_users,
    'beers', v_beers,
    'places', v_places,
    'social', v_social,
    'care', v_care,
    'tech', v_tech
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Board tables (RLS on, no policies, no client access). Rows are never removed.
-- ---------------------------------------------------------------------------
create table if not exists public.board_optin (
  user_id    uuid primary key,
  show       boolean not null default false,
  name       text check (name is null or char_length(name) between 1 and 30),
  updated_at timestamptz not null default now()
);
-- Per user and night: drinks (beers + other drinks) and the rough place (lat 0.05°, lng 0.1° ≈ 5 km).
create table if not exists public.board_nights (
  user_id    uuid not null,
  night      timestamptz not null,
  drinks     int not null default 0,
  lat        float8,
  lng        float8,
  updated_at timestamptz not null default now(),
  primary key (user_id, night)
);
create index if not exists board_nights_night_idx on public.board_nights (night);
create index if not exists board_nights_pos_idx on public.board_nights (lat, lng);
-- Bar positions seen in check-ins / king taps (bars abroad are not in bars_lite).
create table if not exists public.board_bars (
  bar_id     text primary key,
  lat        float8 not null,
  lng        float8 not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.board_rl (
  user_id uuid primary key,
  win     timestamptz not null,
  n       int not null default 0
);
alter table public.board_optin  enable row level security;
alter table public.board_nights enable row level security;
alter table public.board_bars   enable row level security;
alter table public.board_rl     enable row level security;
revoke all on public.board_optin, public.board_nights, public.board_bars, public.board_rl from anon, authenticated;

-- "Radera allt om mig" moves rows to a new random id: an opt-in never follows the row.
create or replace function public.olnu_board_optin_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    new.show := false;
    new.name := null;
  end if;
  return new;
end; $$;
create or replace trigger olnu_board_optin_move
  before update on public.board_optin
  for each row execute function public.olnu_board_optin_tg();

-- Drink count changed → board_nights; an other drink → owner_hours (beers come via beer_events).
create or replace function public.olnu_board_beers_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int := coalesce(new.beer_count, 0) + coalesce(new.other_count, 0);
  v_old int := 0;
  v_oo  int := 0;
begin
  begin
    if tg_op = 'UPDATE' then
      v_old := coalesce(old.beer_count, 0) + coalesce(old.other_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if v_new <> v_old and (v_new > 0 or tg_op = 'UPDATE') then
      insert into public.board_nights as n (user_id, night, drinks, lat, lng, updated_at)
      values (new.user_id, new.expires_at, v_new,
              (round(new.lat::numeric / 0.05) * 0.05)::float8, (round(new.lng::numeric / 0.1) * 0.1)::float8, now())
      on conflict (user_id, night) do update
         set drinks = excluded.drinks,
             lat = case when excluded.drinks > n.drinks or n.lat is null then excluded.lat else n.lat end,
             lng = case when excluded.drinks > n.drinks or n.lng is null then excluded.lng else n.lng end,
             updated_at = now();
    end if;
    if coalesce(new.other_count, 0) > v_oo then
      insert into public.owner_hours as h (hour, beers) values (date_trunc('hour', now()), coalesce(new.other_count, 0) - v_oo)
      on conflict (hour) do update set beers = h.beers + excluded.beers;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;
create or replace trigger olnu_board_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_board_beers_tg();

create or replace function public.olnu_board_bar_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.bar_id is not null and public.olnu_world_ok(new.lat, new.lng) then
      insert into public.board_bars as b (bar_id, lat, lng, updated_at)
      values (new.bar_id, new.lat, new.lng, now())
      on conflict (bar_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;
create or replace trigger olnu_board_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_board_bar_tg();
create or replace trigger olnu_board_bar_taps
  after insert or update on public.bar_taps
  for each row execute function public.olnu_board_bar_tg();

-- Backfill board_bars (check-ins, king taps) and board_nights (medal_nights history; place from the
-- night's check-ins, else the town, else the ~50 km cell centre; then real pin rows override).
insert into public.board_bars (bar_id, lat, lng)
select distinct on (x.bar_id) x.bar_id, x.lat, x.lng
  from (select c.bar_id, c.lat, c.lng, c.created_at at from public.checkins c
        union all
        select t.bar_id, t.lat, t.lng, t.last_at from public.bar_taps t) x
 where x.bar_id is not null and public.olnu_world_ok(x.lat, x.lng)
 order by x.bar_id, x.at desc
on conflict (bar_id) do nothing;

insert into public.board_nights (user_id, night, drinks, lat, lng)
select mn.user_id, mn.night, mn.beers + mn.others,
       (round(coalesce(ck.lat, tw.lat, nullif(split_part(mn.cell, ':', 1), '')::float8)::numeric / 0.05) * 0.05)::float8,
       (round(coalesce(ck.lng, tw.lng, nullif(split_part(mn.cell, ':', 2), '')::float8)::numeric / 0.1) * 0.1)::float8
  from public.medal_nights mn
  left join public.after_nights an on an.user_id = mn.user_id and an.night = mn.night
  left join public.olnu_towns tw on tw.name = an.town
  left join lateral (
    select avg(p.lat) lat, avg(p.lng) lng
      from public.medal_checkins c
      join lateral (select bl.lat, bl.lng from public.bars_lite bl where bl.id = c.bar_id
                    union all
                    select bb.lat, bb.lng from public.board_bars bb where bb.bar_id = c.bar_id
                    limit 1) p on true
     where c.user_id = mn.user_id and c.night = mn.night) ck on true
 where mn.beers + mn.others > 0
on conflict (user_id, night) do nothing;

insert into public.board_nights as n (user_id, night, drinks, lat, lng)
select b.user_id, b.expires_at, b.beer_count + coalesce(b.other_count, 0),
       (round(b.lat::numeric / 0.05) * 0.05)::float8, (round(b.lng::numeric / 0.1) * 0.1)::float8
  from public.beers b
 where b.beer_count + coalesce(b.other_count, 0) > 0
on conflict (user_id, night) do update
   set drinks = greatest(n.drinks, excluded.drinks), lat = excluded.lat, lng = excluded.lng, updated_at = now();

-- ---------------------------------------------------------------------------
-- F. Board RPCs
-- ---------------------------------------------------------------------------
-- Max 30 board reads per user per minute → slow_down.
create or replace function public.olnu_board_rl(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  insert into public.board_rl as r (user_id, win, n) values (p_uid, date_trunc('minute', now()), 1)
  on conflict (user_id) do update
     set n = case when r.win = excluded.win then r.n + 1 else 1 end, win = excluded.win
  returning r.n into v_n;
  if v_n > 30 then
    raise exception 'slow_down';
  end if;
end; $$;

-- Name on the boards: only for users who opted in (own board name, else a group display name).
create or replace function public.olnu_board_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when o.show then coalesce(o.name, (select min(m.display_name) from public.group_members m where m.user_id = p_uid)) end
    from public.board_optin o where o.user_id = p_uid;
$$;

create or replace function public.my_board_optin()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.board_optin%rowtype;
begin
  select * into v_row from public.board_optin o where o.user_id = v_uid;
  return jsonb_build_object('on', coalesce(v_row.show, false), 'name', v_row.name);
end; $$;

-- p_name (optional): the name to show (1–30 chars after cleaning, else invalid_name). Null keeps the old one.
create or replace function public.set_board_optin(p_on boolean, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
  v_row  public.board_optin%rowtype;
begin
  if p_name is not null and char_length(v_name) not between 1 and 30 then
    raise exception 'invalid_name';
  end if;
  insert into public.board_optin as o (user_id, show, name, updated_at)
  values (v_uid, coalesce(p_on, false), nullif(v_name, ''), now())
  on conflict (user_id) do update
     set show = excluded.show, name = coalesce(excluded.name, o.name), updated_at = now()
  returning * into v_row;
  return jsonb_build_object('on', v_row.show, 'name', v_row.name);
end; $$;

-- Users with drinks within p_km (5–50, default 20) of the point. Tonight = live rows of tonight
-- (ghost rows never count), position = the pin. Week = nights from Monday (evening date, Europe/Stockholm),
-- position = the night's rough place. Top 10 + the caller. No positions, no ids.
create or replace function public.local_board(p_lat float8, p_lng float8, p_km float8 default 20, p_period text default 'tonight')
returns table(rank int, name text, total int, nights int, is_me boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid    uuid := public.olnu_uid();
  v_period text := lower(btrim(coalesce(p_period, 'tonight')));
  v_km     float8 := least(50, greatest(5, coalesce(nullif(p_km, 'NaN'::float8), 20)));
  v_lat    float8;
  v_lng    float8;
  v_dlat   float8;
  v_week   date := public.olnu_week_start(now());
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if v_period not in ('tonight', 'week') then
    raise exception 'invalid_period';
  end if;
  perform public.olnu_board_rl(v_uid);
  v_lat := round(p_lat::numeric, 2)::float8;
  v_lng := round(p_lng::numeric, 2)::float8;
  v_dlat := v_km / 111.0;

  return query
  with src as (
    select b.user_id as uid, (b.beer_count + coalesce(b.other_count, 0))::int as d, 1 as nn
      from public.beers b
     where v_period = 'tonight'
       and b.expires_at > now() and not coalesce(b.ghost, false)
       and b.beer_count + coalesce(b.other_count, 0) > 0
       and b.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, b.lat, b.lng) <= v_km * 1000
    union all
    select n.user_id, sum(n.drinks)::int, count(*)::int
      from public.board_nights n
     where v_period = 'week'
       and n.drinks > 0
       and public.olnu_evening(n.night) >= v_week
       and n.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, n.lat, n.lng) <= v_km * 1000
     group by n.user_id
  ),
  ranked as (
    select s.uid, s.d, s.nn,
           rank() over (order by s.d desc, s.nn desc)::int as rk,
           row_number() over (order by s.d desc, s.nn desc, s.uid)::int as rn
      from src s
  )
  select r.rk, public.olnu_board_name(r.uid), r.d, r.nn, r.uid = v_uid
    from ranked r
   where r.rn <= 10 or r.uid = v_uid
   order by r.rn;
end; $$;

-- All-time records near the point (radius as local_board). One row per category for the record holder
-- (top = true; ties → who got there first) plus the caller's own value when the caller is not the holder.
-- Categories: best_night (most drinks one night), nights (most nights out), bars (most different bars
-- checked in), stammis (most nights at one bar), skal (skål given), home (nights with "Jag är hemma").
create or replace function public.wall_of_fame(p_lat float8, p_lng float8, p_km float8 default 20)
returns table(category text, name text, value int, is_me boolean, top boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid  uuid := public.olnu_uid();
  v_km   float8 := least(50, greatest(5, coalesce(nullif(p_km, 'NaN'::float8), 20)));
  v_lat  float8;
  v_lng  float8;
  v_dlat float8;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  perform public.olnu_board_rl(v_uid);
  v_lat := round(p_lat::numeric, 2)::float8;
  v_lng := round(p_lng::numeric, 2)::float8;
  v_dlat := v_km / 111.0;

  return query
  with nights as (
    select n.user_id as uid, n.night, n.drinks, n.updated_at
      from public.board_nights n
     where n.drinks > 0
       and n.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, n.lat, n.lng) <= v_km * 1000
  ),
  bars as (
    select x.bar_id from (
      select bl.id as bar_id, bl.lat, bl.lng from public.bars_lite bl
       where bl.lat between v_lat - v_dlat and v_lat + v_dlat
      union
      select bb.bar_id, bb.lat, bb.lng from public.board_bars bb
       where bb.lat between v_lat - v_dlat and v_lat + v_dlat
         and not exists (select 1 from public.bars_lite b2 where b2.id = bb.bar_id)
    ) x
     where public.olnu_dist_m(v_lat, v_lng, x.lat, x.lng) <= v_km * 1000
  ),
  visits as (
    select c.user_id as uid, c.bar_id, c.night from public.medal_checkins c join bars on bars.bar_id = c.bar_id
  ),
  vals as (
    select 'best_night'::text as cat, x.uid, x.drinks::int as v, x.updated_at as at
      from (select distinct on (ni.uid) ni.uid, ni.drinks, ni.updated_at
              from nights ni order by ni.uid, ni.drinks desc, ni.updated_at) x
    union all
    select 'nights', ni.uid, count(*)::int, max(ni.night) from nights ni group by ni.uid
    union all
    select 'bars', vi.uid, count(distinct vi.bar_id)::int, max(vi.night) from visits vi group by vi.uid
    union all
    select 'stammis', s.uid, max(s.k)::int, max(s.last) from (
      select vi.uid, vi.bar_id, count(distinct vi.night) as k, max(vi.night) as last
        from visits vi group by vi.uid, vi.bar_id) s group by s.uid
    union all
    select 'skal', ni.uid, sum(coalesce(an.skal_given, 0))::int, max(ni.night)
      from nights ni join public.after_nights an on an.user_id = ni.uid and an.night = ni.night
     group by ni.uid
    union all
    select 'home', ni.uid,
           count(*) filter (where coalesce(mn.home, false) or an.home_at is not null)::int, max(ni.night)
      from nights ni
      left join public.medal_nights mn on mn.user_id = ni.uid and mn.night = ni.night
      left join public.after_nights an on an.user_id = ni.uid and an.night = ni.night
     group by ni.uid
  ),
  ranked as (
    select va.cat, va.uid, va.v,
           row_number() over (partition by va.cat order by va.v desc, va.at asc nulls last, va.uid) as rn
      from vals va where va.v > 0
  )
  select r.cat, public.olnu_board_name(r.uid), r.v, r.uid = v_uid, r.rn = 1
    from ranked r
   where r.rn = 1 or r.uid = v_uid
   order by array_position(array['best_night', 'nights', 'bars', 'stammis', 'skal', 'home'], r.cat), r.rn;
end; $$;

-- ---------------------------------------------------------------------------
-- G. Backfill: lifetime (sum of week_beers) >= tonight's drinks for every live row. Quiet:
--    the reached titles are claimed in push_sent (no level-up push) and notified_level is set to the
--    current drink level (no late 5/10 push for drinks before v17).
-- ---------------------------------------------------------------------------
insert into public.week_beers as w (user_id, week, n)
select b.user_id, public.olnu_week_start(now()),
       (b.beer_count + coalesce(b.other_count, 0)) - public.olnu_lifetime(b.user_id)
  from public.beers b
 where b.expires_at > now()
   and (b.beer_count + coalesce(b.other_count, 0)) > public.olnu_lifetime(b.user_id)
on conflict (user_id, week) do update set n = w.n + excluded.n;

insert into public.push_sent (user_id, kind, night)
select b.user_id, 'title:' || t.title, '2100-01-01T00:00:00Z'::timestamptz
  from public.beers b
  cross join lateral (select tt.title from public.olnu_titles() tt
                       where tt.at <= public.olnu_lifetime(b.user_id) and tt.at > 0
                       order by tt.at desc limit 1) t
 where b.expires_at > now()
on conflict do nothing;

update public.beers b
   set notified_level = public.olnu_drink_level(b.beer_count + coalesce(b.other_count, 0))
 where b.expires_at > now()
   and b.notified_level < public.olnu_drink_level(b.beer_count + coalesce(b.other_count, 0));

-- ---------------------------------------------------------------------------
-- H. Grants: new RPCs authenticated only; helpers not callable by clients.
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.olnu_world_ok(double precision, double precision)',
    'public.olnu_in_se_box(double precision, double precision)',
    'public.olnu_drink_level(integer)',
    'public.olnu_world_pos_tg()',
    'public.olnu_board_optin_tg()',
    'public.olnu_board_beers_tg()',
    'public.olnu_board_bar_tg()',
    'public.olnu_board_rl(uuid)',
    'public.olnu_board_name(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
  end loop;
  foreach f in array array[
    'public.post_beer_v2(double precision, double precision, boolean, boolean)',
    'public.post_other_v2(text, double precision, double precision, boolean)',
    'public.my_board_optin()',
    'public.set_board_optin(boolean, text)',
    'public.local_board(double precision, double precision, double precision, text)',
    'public.wall_of_fame(double precision, double precision, double precision)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;
