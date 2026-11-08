-- 0321 📍 PINNEN FÖLJER MED — the friend views read the follow point (0320). OWNER-RUN: this REPLACES the existing
-- function public.olnu_pins (poll_v2 reads it; poll_public / strangers do not change). Base: the live definition of
-- 2026-11-08 (same signature, same columns, same order). Only the KNOWN rows (me + group-mates) change:
--   lat / lng / precise / snap / bar_id come from pin_follow when it has a point for the same night that is newer than the
--   last beer (beers.beer_at). A newer beer always wins (the beer point is the pin again).
-- Strangers keep the snapped / rounded beer position (owner: "for people that don't know him you don't need to change
-- the position"). beer_count stays the night total for known rows (unchanged).
-- Before: the friend pin stays where the last beer was logged. After: it follows the phone (app open, see pinfolj.js).

create or replace function public.olnu_pins(p_uid uuid, p_min_lat double precision, p_min_lng double precision,
                                            p_max_lat double precision, p_max_lng double precision)
 returns table(beer_id bigint, pin_id text, lat double precision, lng double precision, snap text, bar_id text, precise boolean,
               beer_count integer, other_count integer, other_kind text, created_at timestamp with time zone, is_mine boolean,
               is_friend boolean, friend_name text)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
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
  cand0 as (
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, mm.uid is not null as known, mm.fname, b.expires_at, coalesce(b.beer_at, b.updated_at) as beer_at
      from public.beers b
      left join me_and_mates mm on mm.uid = b.user_id
     where b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and (not v_box or (b.lat between v_a and v_c and b.lng between v_b and v_d))
    union all
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, true, mm.fname, b.expires_at, coalesce(b.beer_at, b.updated_at)
      from me_and_mates mm
      join public.beers b on b.user_id = mm.uid
     where v_box and b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and not (b.lat between v_a and v_c and b.lng between v_b and v_d)
  ),
  cand as (   -- 0321: the follow point, for known rows only
    select c0.*, fw.lat as f_lat, fw.lng as f_lng, fw.precise as f_prec, fw.bar_id as f_bar
      from cand0 c0
      left join public.pin_follow fw
        on c0.known and fw.user_id = c0.user_id and fw.night = c0.expires_at and fw.lat is not null and fw.at > c0.beer_at
  )
  select c.id,
         case when c.known then c.id::text
              else 'p' || left(md5(v_secret || ':' || c.id::text || ':' || v_bucket::text), 15) end,
         case when c.known then coalesce(c.f_lat, c.lat) else coalesce(c.snap_lat, (round(c.lat::numeric / 0.005) * 0.005)::float8) end,
         case when c.known then coalesce(c.f_lng, c.lng) else coalesce(c.snap_lng, (round(c.lng::numeric / 0.01) * 0.01)::float8) end,
         case when c.known then (case when coalesce(c.f_prec, c.precise) then 'exact' else 'area' end)
              when c.snap_bar is not null then 'bar' else 'area' end,
         case when c.known and c.f_lat is not null then c.f_bar else c.snap_bar end,
         case when c.known then coalesce(c.f_prec, c.precise) else c.snap_bar is not null end,
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
     and not public.olnu_ub_hidden(p_uid, c.user_id);
end;
$function$;
