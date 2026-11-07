-- 0222 ⚡ SPEED · konto vid första handling (owner 2026-11-07; additive, no existing function changed).
-- A first visit no longer makes an anonymous account on page open (empty accounts). Until the first real action
-- (🍺 ÖL!, check-in, join a group, open an invite …) the app has NO session and reads the map with this RPC instead of
-- poll_v2. It is exactly the stranger view of poll_v2: the same olnu_pins() rows for p_uid = null (snapped to the bar or the
-- 550 m grid, hashed ids that change every 10 min, created_at in 15 min steps), stranger check-ins (no names), the same
-- k-anonymous heat, live_total without the test zone. No "me", no friends, no rallies, no names. anon + authenticated.

create or replace function public.poll_public(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision,
  p_max_lng double precision, p_heat boolean default false)
returns json language plpgsql stable security definer set search_path to 'public' as $$
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
                          where c0.expires_at > now() and not public.olnu_is_test_zone(c0.lat, c0.lng)
                            and c0.lat between v_a and v_c and c0.lng between v_b and v_d
                          order by c0.created_at limit 2000) c),
    'rallies', '[]'::json,
    'heat', case when coalesce(p_heat, false) then
              (select coalesce(json_agg(json_build_array(h.lat, h.lng, h.w)), '[]'::json)
                 from public.olnu_heat(v_a - (v_c - v_a) * 0.5, v_b - (v_d - v_b) * 0.5,
                                       v_c + (v_c - v_a) * 0.5, v_d + (v_d - v_b) * 0.5, 3000) h)
            end
  );
end;
$$;
revoke all on function public.poll_public(double precision, double precision, double precision, double precision, boolean) from public;
grant execute on function public.poll_public(double precision, double precision, double precision, double precision, boolean) to anon, authenticated;
