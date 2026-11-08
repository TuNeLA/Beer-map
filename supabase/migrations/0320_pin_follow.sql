-- 0320 📍 PINNEN FÖLJER MED (owner 2026-11-08: "his last beer was at my friend's place, then he was at the bar for 3–4 hours,
-- but the map still showed him at my friend's home"). ADDITIVE ONLY: one new table + one new RPC. No existing function changes.
-- The friend views start to read this table in 0321 (owner-run: it replaces olnu_pins).
--
-- pin_follow(p_lat, p_lng, p_acc, p_area): the app (docs/js/pinfolj.js) calls it while it is open, when 2 GPS readings
-- (accuracy <= 50 m, >= 2 min apart) are both > 150 m from the pin. It stores a SEPARATE friend-visible position:
--   * only with a live, visible pin tonight (not stopped, not ghost, >= 1 drink);
--   * accuracy <= 50 m; at most 1 call per 2 minutes per person (server rate limit);
--   * moved <= 150 m from where friends see the pin now = nothing stored ({moved:false});
--   * "Bara område" (the pin was posted with area precision, or p_area) = the rounded area grid, never the exact point;
--   * checked in (checkins) and the reading is <= 80 m from that bar = the bar's own point + bar_id (snaps to the bar);
--   * a newer beer (beers.beer_at > at) always wins: the beer position is the pin again (0321 compares the times).
-- Strangers / the public map never read this table (0321 uses it for known rows = me + group-mates only).
-- Retention: one row per person; rows of nights older than 36 h lose their position on the next call by anyone.
-- Account removal: the FK cascades from auth.users (delete_my_data_v2 removes the auth.users row last).

create table if not exists public.pin_follow (
  user_id uuid primary key references auth.users (id) on delete cascade,
  night   timestamptz not null,
  lat     double precision,
  lng     double precision,
  precise boolean not null default true,
  bar_id  text,
  acc     real,
  at      timestamptz not null default now()
);
create index if not exists pin_follow_night_ix on public.pin_follow (night);
alter table public.pin_follow enable row level security;
revoke all on table public.pin_follow from public, anon, authenticated;
grant all on table public.pin_follow to service_role;

create or replace function public.pin_follow(p_lat double precision, p_lng double precision, p_acc double precision,
                                             p_area boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_gap  constant interval := interval '2 minutes';
  b      public.beers%rowtype;
  f      public.pin_follow%rowtype;
  c      public.checkins%rowtype;
  v_has  boolean := false;
  v_flat float8; v_flng float8;
  v_lat  float8; v_lng float8; v_bar text := null;
  v_prec boolean;
  v_d    float8;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_lat is null or p_lng is null or p_acc is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_acc in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then
    raise exception 'invalid_pos';
  end if;
  if not public.olnu_world_ok(p_lat, p_lng) or not public.olnu_in_se_box(p_lat, p_lng) then
    return jsonb_build_object('ok', false, 'reason', 'outside');
  end if;
  if p_acc < 0 or p_acc > 50 then
    return jsonb_build_object('ok', false, 'reason', 'accuracy');
  end if;

  select * into b from public.beers x where x.user_id = v_uid and x.expires_at > now();
  if not found or coalesce(b.stopped, false) or coalesce(b.ghost, false)
     or coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_pinfollow:' || v_uid::text, 0));
  select * into f from public.pin_follow x where x.user_id = v_uid;
  if found then
    v_has := true;
    if f.at > now() - v_gap then
      return jsonb_build_object('ok', false, 'reason', 'wait',
        'wait_seconds', greatest(1, ceil(extract(epoch from (f.at + v_gap - now())))::int));
    end if;
  end if;

  -- where group-mates see the pin now: the follow point (same night, newer than the last beer) or the beer point
  if v_has and f.night = b.expires_at and f.lat is not null and f.at > coalesce(b.beer_at, b.updated_at) then
    v_flat := f.lat; v_flng := f.lng;
  else
    v_flat := b.lat; v_flng := b.lng;
  end if;
  v_d := public.olnu_dist_m(p_lat, p_lng, v_flat, v_flng);
  if v_d <= 150 then
    return jsonb_build_object('ok', true, 'moved', false, 'd', round(v_d::numeric));
  end if;

  v_prec := coalesce(b.precise, false) and not coalesce(p_area, false);
  if v_prec then
    select * into c from public.checkins x where x.user_id = v_uid and x.expires_at > now();
    if found and public.olnu_dist_m(p_lat, p_lng, c.lat, c.lng) <= 80 then
      v_lat := c.lat; v_lng := c.lng; v_bar := c.bar_id;
    else
      v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
    end if;
  else
    v_lat := (round(p_lat::numeric / 0.005) * 0.005)::float8;
    v_lng := (round(p_lng::numeric / 0.01) * 0.01)::float8;
  end if;

  insert into public.pin_follow as x (user_id, night, lat, lng, precise, bar_id, acc, at)
  values (v_uid, b.expires_at, v_lat, v_lng, v_prec, v_bar, round(p_acc::numeric, 1)::real, now())
  on conflict (user_id) do update
     set night = excluded.night, lat = excluded.lat, lng = excluded.lng, precise = excluded.precise,
         bar_id = excluded.bar_id, acc = excluded.acc, at = excluded.at;

  -- retention: an old night keeps no position (small table, index on night)
  update public.pin_follow x set lat = null, lng = null, bar_id = null
   where x.night < now() - interval '36 hours' and x.lat is not null;

  return jsonb_build_object('ok', true, 'moved', true, 'd', round(v_d::numeric),
    'lat', v_lat, 'lng', v_lng, 'precise', v_prec, 'bar_id', v_bar);
end;
$function$;

revoke all on function public.pin_follow(double precision, double precision, double precision, boolean) from public, anon;
grant execute on function public.pin_follow(double precision, double precision, double precision, boolean) to authenticated;
