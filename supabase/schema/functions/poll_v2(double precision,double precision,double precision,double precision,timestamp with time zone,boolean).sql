-- public.poll_v2(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_since timestamp with time zone, p_heat boolean)
-- live md5(pg_get_functiondef) = 321f1220def2958d506286c0c63befd3
CREATE OR REPLACE FUNCTION public.poll_v2(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_heat boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := public.olnu_uid();
  v_cap     constant int := 1500;
  v_a       float8; v_b float8; v_c float8; v_d float8;
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
                            (select b.user_id from public.beers b where b.id = sel.beer_id)) end,
           'meriter',     case when sel.is_mine or sel.is_friend then public.olnu_meriter(
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
                        and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
                        and (b.user_id = v_uid or not public.olnu_is_test_zone(b.lat, b.lng) or (select public.olnu_is_test_user(v_uid)))),
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
                              where c0.expires_at > now() and (c0.user_id = v_uid or not public.olnu_is_test_zone(c0.lat, c0.lng) or (select public.olnu_is_test_user(v_uid)))
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
