-- 0340 — "Bara vänner" visibility (ux3 #8, owner-run: it REPLACES the read core olnu_pins, so it changes what strangers get).
-- Modes (client, js/pnvis.js): Alla = as today (strangers see the area / the bar) · Bara vänner = friends + group mates see
-- the pin, strangers get NO row · Spöke = nobody (the existing post_beer_v2 p_hidden / stop_beer, unchanged).
-- 11 Nov (sec): "friends" = shared group OR accepted friend (friendships, olnu_are_friends), never a blocked person.
-- A friend outside your groups gets your pin in the same form as with "Alla" (area / bar, no name); a group mate as before.
-- New: table olnu_visibility (one row per user who picked "Bara vänner"), set_visibility(boolean), my_visibility().
-- olnu_pins: one added condition (marked "0340"); everything else is the live definition of 2026-11-08 copied 1:1.
-- Not changed (aggregates, never a position or a name): heat_points, zone_counts, bar crowd counts. Owner: decide if
-- "Bara vänner" should also leave those (then add the same not-exists to them).
-- Additive only: no data is removed. Safe to run twice.

create table if not exists public.olnu_visibility (
  user_id uuid primary key,
  friends_only boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.olnu_visibility enable row level security;   -- no policies: only the security definer functions below

create or replace function public.set_visibility(p_friends_only boolean)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  insert into public.olnu_visibility (user_id, friends_only, updated_at) values (v_uid, coalesce(p_friends_only, false), now())
  on conflict (user_id) do update set friends_only = excluded.friends_only, updated_at = now();
  return json_build_object('v', 1, 'friends_only', coalesce(p_friends_only, false));
end $$;

create or replace function public.my_visibility()
returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object('v', 1, 'friends_only', coalesce((select v.friends_only from public.olnu_visibility v where v.user_id = public.olnu_uid()), false));
$$;

revoke all on function public.set_visibility(boolean) from public;
revoke all on function public.my_visibility() from public;
grant execute on function public.set_visibility(boolean) to anon, authenticated;
grant execute on function public.my_visibility() to anon, authenticated;

CREATE OR REPLACE FUNCTION public.olnu_pins(p_uid uuid, p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision)
 RETURNS TABLE(beer_id bigint, pin_id text, lat double precision, lng double precision, snap text, bar_id text, precise boolean, beer_count integer, other_count integer, other_kind text, created_at timestamp with time zone, is_mine boolean, is_friend boolean, friend_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_box    boolean := p_min_lat is not null and p_min_lng is not null and p_max_lat is not null and p_max_lng is not null;
  v_secret text := (select s.secret from public.olnu_secrets s where s.id = 1);
  v_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_store  boolean := public.olnu_store_on();
  v_a float8 := p_min_lat - 0.0035;  v_c float8 := p_max_lat + 0.0035;
  v_b float8 := p_min_lng - 0.0070;  v_d float8 := p_max_lng + 0.0070;
begin
  return query
  with mates as (
    select am.user_id as uid, min(am.display_name) as fname
      from public.group_members cm
      join public.group_members am on am.group_id = cm.group_id
     where cm.user_id = p_uid and am.user_id <> p_uid
     group by am.user_id
  ),
  me_and_mates as (
    select m.uid, m.fname from mates m
    union all
    select p_uid, null::text
  ),
  cand as (
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, mm.uid is not null as known, mm.fname
      from public.beers b
      left join me_and_mates mm on mm.uid = b.user_id
     where b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and (not v_box or (b.lat between v_a and v_c and b.lng between v_b and v_d))
    union all
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, true, mm.fname
      from me_and_mates mm
      join public.beers b on b.user_id = mm.uid
     where v_box and b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and not (b.lat between v_a and v_c and b.lng between v_b and v_d)
  )
  select c.id,
         case when c.known then c.id::text
              else 'p' || left(md5(v_secret || ':' || c.id::text || ':' || v_bucket::text), 15) end,
         case when c.known then c.lat else coalesce(c.snap_lat, (round(c.lat::numeric / 0.005) * 0.005)::float8) end,
         case when c.known then c.lng else coalesce(c.snap_lng, (round(c.lng::numeric / 0.01) * 0.01)::float8) end,
         case when c.known then (case when c.precise then 'exact' else 'area' end)
              when c.snap_bar is not null then 'bar' else 'area' end,
         c.snap_bar,
         case when c.known then c.precise else c.snap_bar is not null end,
         case when v_store and not c.known then 1 else c.beer_count end,
         case when v_store and not c.known then 0 else coalesce(c.other_count, 0) end,
         case when v_store and not c.known then null else c.other_kind end,
         case when c.known then c.created_at
              else to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900) end,
         c.user_id = p_uid, c.known and c.user_id <> p_uid, c.fname
    from cand c
   where (c.known or not v_box
      or (coalesce(c.snap_lat, c.lat) between p_min_lat and p_max_lat
          and coalesce(c.snap_lng, c.lng) between p_min_lng and p_max_lng))
     and (c.known or not public.olnu_is_test_zone(c.lat, c.lng) or (select public.olnu_is_test_user(p_uid)))
     and not public.olnu_ub_hidden(p_uid, c.user_id)
     -- 0340: "Bara vänner": a stranger never gets this user's pin. Friends (accepted, Vänner list) still get it
     -- in the same form as with "Alla" (area / bar, no name); group mates as before (c.known). Blocked: never (above).
     and (c.known or not exists (select 1 from public.olnu_visibility v where v.user_id = c.user_id and v.friends_only)
          or public.olnu_are_friends(p_uid, c.user_id));
end;
$function$;
