-- 0517 · check-in: strangers see a check-in only when the place is proven (lane srv1, security test 14 Nov, finding 3). OWNER-RUN. Staging first.
-- A3-EXCEPTION: poll_v2 is not the same text on live (before 0465) and in the release model, so its one new line is an exact anchored patch that lands on both; a full CREATE OR REPLACE from one model would undo the other. The other three functions are the same text in both models: full CREATE OR REPLACE. Coordinator dry-runs the file on live in a rolled-back transaction first.
-- Check after the run (expect t, t, t, t, t):
--   select position('/*s517*/' in pg_get_functiondef('public.check_in(text, text, double precision, double precision)'::regprocedure)) > 0,
--     position('/*s517*/' in pg_get_functiondef('public.live_checkins()'::regprocedure)) > 0,
--     position('/*s517*/' in pg_get_functiondef('public.poll_public(double precision, double precision, double precision, double precision, boolean)'::regprocedure)) > 0,
--     position('/*s517*/' in pg_get_functiondef('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)'::regprocedure)) > 0,
--     exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'checkins' and column_name = 'unverified');
--
-- Why: check_in took any bar id, any name and any position. One person with free anonymous accounts could make a bar look
-- full, or invent a bar with a free text name. Strangers got these rows (poll_v2.checkins, poll_public, live_checkins).
-- The client sends the BAR position, not the user position (same 4 parameters as before), so the server proves the PLACE:
--   1. the id is an active bars_lite row and the sent point is within 250 m of it (the name then comes from the server row), or
--   2. the id is the caller's own place suggestion (waiting or approved) and the point is within 250 m of it, or
--   3. it is the same place as the caller's proven check-in before (check in again, undo of "Hemma"), or
--   4. the caller's own fresh position (90 min: live pin, pin_follow, drink_log, crew_tracks, Hitta, walk) is within 600 m.
-- A check-in that is NOT proven is not refused (a real check-in never fails: a bar abroad, an old bar list, no GPS).
-- It gets checkins.unverified = true: the caller, group mates and friends see it as before, strangers and people with
-- no login do not get the row. Result shape: the same keys as before plus 'verified' (true / false). No new error code.
-- Also: '<' and '>' are removed from the bar name (finding 8, this field only).
-- Not changed here: the medal / merit / king triggers on checkins (they count every check-in, as before).
-- Functions replaced (snapshot these first = the rollback): check_in(text, text, double precision, double precision),
--   live_checkins(), poll_public(double precision ×4, boolean) [full replace, text = snapshot 8 Nov + 0430 = staging 15 Nov];
--   poll_v2(double precision ×4, timestamp with time zone, boolean) [one anchored line].
-- New: column checkins.unverified (boolean, default false: every row that exists stays visible), olnu_s517_near_me, olnu_fn_expect.
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_sec_patch (0430), olnu_strip_cr (0436), olnu_dist_m, olnu_are_friends.

alter table public.checkins add column if not exists unverified boolean not null default false;

-- Guard for a full CREATE OR REPLACE: stop when the stored function is not the text this file was made from.
create or replace function public.olnu_fn_expect(p_fn regprocedure, p_marker text, p_md5 text[])
returns text language plpgsql set search_path = public as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');
begin
  if position(p_marker in v_def) > 0 then return 'has ' || p_marker || ' ' || p_fn::text; end if;
  if md5(v_def) = any (p_md5) then return 'ok ' || p_fn::text; end if;
  raise exception 'olnu_fn_expect %: this function is not the text that the file was made from (md5 %). Stop and tell the coordinator.', p_fn::text, md5(v_def);
end $$;
revoke all on function public.olnu_fn_expect(regprocedure, text, text[]) from public, anon, authenticated;

-- The caller's own fresh position near a point. Internal: only check_in calls it.
create or replace function public.olnu_s517_near_me(p_uid uuid, p_lat double precision, p_lng double precision)
returns boolean language sql stable set search_path = public as $$
  select p_uid is not null and p_lat is not null and p_lng is not null and (
       exists (select 1 from public.beers b where b.user_id = p_uid and b.updated_at > now() - interval '90 minutes'
                  and public.olnu_dist_m(b.lat, b.lng, p_lat, p_lng) <= 600)
    or exists (select 1 from public.pin_follow f where f.user_id = p_uid and f.at > now() - interval '90 minutes'
                  and f.lat is not null and f.lng is not null and public.olnu_dist_m(f.lat, f.lng, p_lat, p_lng) <= 600)
    or exists (select 1 from public.drink_log d where d.user_id = p_uid and d.at > now() - interval '90 minutes'
                  and d.lat is not null and d.lng is not null and public.olnu_dist_m(d.lat, d.lng, p_lat, p_lng) <= 600)
    or exists (select 1 from public.crew_tracks t where t.user_id = p_uid and t.at > now() - interval '90 minutes'
                  and public.olnu_dist_m(t.lat, t.lng, p_lat, p_lng) <= 600)
    or exists (select 1 from public.find_pos fp where fp.user_id = p_uid and fp.updated_at > now() - interval '90 minutes'
                  and fp.lat is not null and fp.lng is not null and public.olnu_dist_m(fp.lat, fp.lng, p_lat, p_lng) <= 600)
    or exists (select 1 from public.walks w where w.user_id = p_uid and w.pos_at > now() - interval '90 minutes'
                  and w.lat is not null and w.lng is not null and public.olnu_dist_m(w.lat, w.lng, p_lat, p_lng) <= 600));
$$;
revoke all on function public.olnu_s517_near_me(uuid, double precision, double precision) from public, anon, authenticated;

select public.olnu_fn_expect('public.check_in(text, text, double precision, double precision)', '/*s517*/', array['a477f25068ff9b370d4d33a05fea8a84']);
CREATE OR REPLACE FUNCTION public.check_in(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := btrim(regexp_replace(coalesce(p_bar_id, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_bar_name, ''), '[\x00-\x1F\x7F<>]', ' ', 'g'), '\s+', ' ', 'g'));
  v_row  public.checkins%rowtype;
  v_cool constant interval := interval '2 minutes';
  v_lat  float8; v_lng float8;
  v_ok   boolean := false;   -- /*s517*/ true = the place is proven (strangers may see this check-in)
  v_sname text; v_slat float8; v_slng float8;
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

  perform pg_advisory_xact_lock(hashtextextended('olnu_checkin:' || v_uid::text, 0));
  select * into v_row from public.checkins c where c.user_id = v_uid;
  if found and v_row.created_at > now() - v_cool then
    return jsonb_build_object('ok', false,
      'bar_name', case when v_row.expires_at > now() then v_row.bar_name else null end,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_row.created_at + v_cool - now())))::int));
  end if;

  v_lat := round(p_lat::numeric, 5)::float8;  v_lng := round(p_lng::numeric, 5)::float8;
  -- 1. A known place: the id is in bars_lite and the sent point is at that place (250 m). The name comes from the server row.
  select bl.name, bl.lat, bl.lng into v_sname, v_slat, v_slng from public.bars_lite bl where bl.id = v_id and bl.active;
  if found and public.olnu_dist_m(v_slat, v_slng, v_lat, v_lng) <= 250 then
    v_ok := true;
    v_name := coalesce(nullif(left(btrim(regexp_replace(coalesce(v_sname, ''), '[\x00-\x1F\x7F<>]', ' ', 'g')), 60), ''), v_name);
  end if;
  -- 2. The caller's own place suggestion (waiting or approved), at its stored point.
  if not v_ok then
    select s.name, s.lat, s.lng into v_sname, v_slat, v_slng from public.place_suggestions s
     where s.bar_id = v_id and s.user_id = v_uid and s.status in ('pending', 'ok') order by s.id desc limit 1;
    if found and public.olnu_dist_m(v_slat, v_slng, v_lat, v_lng) <= 250 then
      v_ok := true;
      v_name := coalesce(nullif(left(btrim(regexp_replace(coalesce(v_sname, ''), '[\x00-\x1F\x7F<>]', ' ', 'g')), 60), ''), v_name);
    end if;
  end if;
  -- 3. The same place as the caller's proven check-in before (check in again, undo of "Hemma"). The proven name stays.
  if not v_ok and v_row.user_id is not null and not v_row.unverified and v_row.bar_id = v_id
     and v_row.created_at > now() - interval '24 hours'
     and public.olnu_dist_m(v_row.lat, v_row.lng, v_lat, v_lng) <= 250 then
    v_ok := true;
    v_name := v_row.bar_name;
  end if;
  -- 4. A place the server does not know (a bar abroad, a new place): the caller's own fresh position is near it.
  if not v_ok and public.olnu_s517_near_me(v_uid, v_lat, v_lng) then
    v_ok := true;
  end if;
  -- Not proven: the check-in still works for the caller, the group and friends. Strangers do not get it
  -- (poll_v2, poll_public, live_checkins read the unverified flag).

  insert into public.checkins (user_id, bar_id, bar_name, lat, lng, created_at, expires_at, unverified)
  values (v_uid, v_id, v_name, v_lat, v_lng, now(), public.olnu_next_expiry(), not v_ok)
  on conflict (user_id) do update
     set bar_id = excluded.bar_id, bar_name = excluded.bar_name, lat = excluded.lat, lng = excluded.lng,
         created_at = excluded.created_at, expires_at = excluded.expires_at, unverified = excluded.unverified;

  return jsonb_build_object('ok', true, 'bar_name', v_name, 'wait_seconds', 0, 'verified', v_ok);
end;
$function$;

select public.olnu_fn_expect('public.live_checkins()', '/*s517*/', array['c2e0289f97bb05c4ae9bf3b018924a0b']);
CREATE OR REPLACE FUNCTION public.live_checkins()
 RETURNS TABLE(bar_id text, bar_name text, lat double precision, lng double precision, name text, is_mine boolean, is_friend boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select c.bar_id, c.bar_name, c.lat, c.lng,
         case when c.user_id = v_uid
              then (select min(mm.display_name) from public.group_members mm where mm.user_id = v_uid)
              else f.fname end,
         (c.user_id = v_uid),
         (c.user_id <> v_uid and f.fname is not null),
         c.created_at
    from public.checkins c
    left join lateral (
      select min(am.display_name) as fname
        from public.group_members am
        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
       where am.user_id = c.user_id and c.user_id <> v_uid
    ) f on true
   where c.expires_at > now() and not public.olnu_ub_hidden(v_uid, c.user_id) /*sec0430*/
     and (not c.unverified or c.user_id = v_uid or f.fname is not null or public.olnu_are_friends(v_uid, c.user_id)) /*s517*/
     and (c.user_id = v_uid or f.fname is not null
          or not exists (select 1 from public.olnu_visibility v0 where v0.user_id = c.user_id and v0.friends_only)
          or public.olnu_are_friends(v_uid, c.user_id))
     and (c.user_id = v_uid or f.fname is not null or not public.olnu_is_test_zone(c.lat, c.lng) or (select public.olnu_is_test_user(v_uid)))
   order by c.created_at
   limit 2000;
end;
$function$;

select public.olnu_fn_expect('public.poll_public(double precision, double precision, double precision, double precision, boolean)', '/*s517*/', array['98f4f4092437451fbefd510b177a9f64']);
CREATE OR REPLACE FUNCTION public.poll_public(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_heat boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cap  constant int := 1500;
  v_a float8; v_b float8; v_c float8; v_d float8;
  v_clat float8; v_clng float8; v_cos float8; v_mlat float8; v_mlng float8;
  v_pins json; v_n_str int;
begin
  if p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
     or 'NaN'::float8 in (p_min_lat, p_min_lng, p_max_lat, p_max_lng)
     or abs(p_min_lat) = 'Infinity'::float8 or abs(p_max_lat) = 'Infinity'::float8
     or abs(p_min_lng) = 'Infinity'::float8 or abs(p_max_lng) = 'Infinity'::float8 then
    raise exception 'invalid_bbox';
  end if;
  -- same box rules as poll_v2 (date line, 15 % margin, clamp)
  v_a := least(p_min_lat, p_max_lat);  v_c := greatest(p_min_lat, p_max_lat);
  v_b := least(p_min_lng, p_max_lng);  v_d := greatest(p_min_lng, p_max_lng);
  if p_min_lng > p_max_lng and p_min_lng <= 180 and p_max_lng >= -180 then v_b := -180; v_d := 180; end if;
  v_mlat := greatest((v_c - v_a) * 0.15, 0.005);
  v_mlng := greatest((v_d - v_b) * 0.15, 0.01);
  v_a := greatest(-85.0, v_a - v_mlat);  v_c := least(85.0, v_c + v_mlat);
  v_b := v_b - v_mlng;  v_d := v_d + v_mlng;
  if v_b < -180 or v_d > 180 then v_b := -180; v_d := 180; end if;
  if v_a > v_c or v_b > v_d then v_a := 0; v_c := 0; v_b := 0; v_d := 0; end if;
  v_clat := (v_a + v_c) / 2;  v_clng := (v_b + v_d) / 2;  v_cos := cos(radians(v_clat));

  with p as (select * from public.olnu_pins(null::uuid, v_a, v_b, v_c, v_d)),
  ranked as (
    select p.*, row_number() over (order by power(p.lat - v_clat, 2) + power((p.lng - v_clng) * v_cos, 2), p.pin_id) as rn,
           count(*) over () as nstr
      from p
  ),
  sel as (select * from ranked r where r.rn <= v_cap),
  sk as (select s.beer_id as sid, count(*)::int as n from public.skals s join sel on sel.beer_id = s.beer_id group by s.beer_id),
  rx1 as (select r.beer_id as rid, r.emoji, count(*)::int as n from public.reactions r join sel on sel.beer_id = r.beer_id where r.active group by r.beer_id, r.emoji),
  rx as (select rx1.rid, jsonb_object_agg(rx1.emoji, rx1.n) as counts from rx1 group by rx1.rid)
  select coalesce(json_agg(json_strip_nulls(json_build_object(
           'id', sel.pin_id, 'lat', sel.lat, 'lng', sel.lng, 'snap', sel.snap, 'bar_id', sel.bar_id, 'precise', sel.precise,
           'beer_count', sel.beer_count, 'other_count', nullif(sel.other_count, 0),
           'other_kind', case when sel.other_count > 0 then sel.other_kind end,
           'created_at', sel.created_at, 'skal_count', sk.n, 'rx', rx.counts
         )) order by sel.created_at, sel.pin_id), '[]'::json),
         coalesce(max(sel.nstr), 0)
    into v_pins, v_n_str
    from sel left join sk on sk.sid = sel.beer_id left join rx on rx.rid = sel.beer_id;

  return json_build_object(
    'v', 1, 'public', true, 'server_time', now(), 'full', true,
    'bbox', json_build_array(v_a, v_b, v_c, v_d),
    'pins', v_pins, 'capped', v_n_str > v_cap, 'pins_in_view', v_n_str,
    'live_total', (select count(*)::int from public.beers b
                    where b.expires_at > now() and not b.stopped
                      and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
                      and not public.olnu_is_test_zone(b.lat, b.lng)),
    'me', null,
    'checkins', (select coalesce(json_agg(json_build_object(
                    'bar_id', c.bar_id, 'bar_name', c.bar_name, 'lat', c.lat, 'lng', c.lng, 'name', null,
                    'is_mine', false, 'is_friend', false,
                    'created_at', to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900)
                  ) order by c.created_at), '[]'::json)
                   from (select * from public.checkins c0
                          where c0.expires_at > now() and not c0.unverified /*s517*/ and not public.olnu_is_test_zone(c0.lat, c0.lng)
                            and c0.lat between v_a and v_c and c0.lng between v_b and v_d /*sec0430*/
                            and not exists (select 1 from public.olnu_visibility v0 where v0.user_id = c0.user_id and v0.friends_only)
                          order by c0.created_at limit 2000) c),
    'rallies', '[]'::json,
    'heat', case when coalesce(p_heat, false) then
              (select coalesce(json_agg(json_build_array(h.lat, h.lng, h.w)), '[]'::json)
                 from public.olnu_heat(v_a - (v_c - v_a) * 0.5, v_b - (v_d - v_b) * 0.5,
                                       v_c + (v_c - v_a) * 0.5, v_d + (v_d - v_b) * 0.5, 3000) h)
            end
  );
end;
$function$;

-- poll_v2: strangers do not get a check-in that is not proven (the caller, group mates and friends do)
select public.olnu_sec_patch('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)', '/*s517*/',
  array[$a$where not public.olnu_ub_hidden(v_uid, c.user_id) /*sec0430*/$a$],
  array[$a$where not public.olnu_ub_hidden(v_uid, c.user_id) /*sec0430*/
                        and (not c.unverified or c.user_id = v_uid or f.fname is not null or public.olnu_are_friends(v_uid, c.user_id)) /*s517*/$a$]);

select public.olnu_strip_cr();
