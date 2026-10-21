-- Öl Nu — ✏️ "Rita krogens yta" (CONTRACT "BAREA · krogens yta"): users draw the bar's own premises on the map.
-- Open data has no premises outlines, so the map lights up the part of the house near the bar (build time, see
-- scripts/lit-clip.mjs). A drawn area replaces that part once the owner approves it in stats.html.
-- Additive: two new tables, new functions. Rows are never removed: status pending → ok | rejected, and an older
-- area of the same bar gets superseded_at (a newer approved one wins; a user's newer pending one hides their older one).
-- Owner trust: the owner opens stats.html on his own phone (same origin as the app) and taps "📱 Den här mobilen är min";
-- that calls owner_trust_me(owner key) WITH the app's session, so areas drawn by that account are approved at once.

create table if not exists public.bar_areas (
  id            bigserial primary key,
  bar_id        text not null check (char_length(bar_id) between 1 and 80),
  polygon       jsonb not null,                       -- [[lng, lat], …] open ring, 3–40 points, 6 decimals
  area_m2       real not null,
  n_pts         int not null,
  bar_lat       double precision not null,
  bar_lng       double precision not null,
  created_by    uuid not null,
  status        text not null default 'pending' check (status in ('pending', 'ok', 'rejected')),
  auto          boolean not null default false,       -- approved at once (trusted owner account)
  created_at    timestamptz not null default now(),
  status_at     timestamptz,
  superseded_at timestamptz
);
create index if not exists bar_areas_pos_idx on public.bar_areas (bar_lat, bar_lng) where superseded_at is null;
create index if not exists bar_areas_user_idx on public.bar_areas (created_by, created_at desc);
create index if not exists bar_areas_bar_idx on public.bar_areas (bar_id, status);
alter table public.bar_areas enable row level security;
revoke all on public.bar_areas from anon, authenticated;
revoke all on sequence public.bar_areas_id_seq from anon, authenticated;
grant all on public.bar_areas to service_role;

create table if not exists public.bar_area_trusted (
  user_id    uuid primary key,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bar_area_trusted enable row level security;
revoke all on public.bar_area_trusted from anon, authenticated;
grant all on public.bar_area_trusted to service_role;

-- Where is the bar? bars_lite (bars.json, bars-extra.json, approved suggestions), else a places.json id pl_<lat·1e5>_<lng·1e5>.
create or replace function public.olnu_area_bar_pos(p_bar_id text)
returns double precision[] language plpgsql stable security definer set search_path = public as $$
declare v double precision[]; m text[];
begin
  select array[b.lat, b.lng] into v from public.bars_lite b where b.id = p_bar_id and b.active;
  if v is not null then return v; end if;
  m := regexp_match(coalesce(p_bar_id, ''), '^pl_(-?\d{1,8})_(-?\d{1,8})$');
  if m is not null then
    v := array[m[1]::double precision / 1e5, m[2]::double precision / 1e5];
    if abs(v[1]) <= 85 and abs(v[2]) <= 180 then return v; end if;
  end if;
  return null;
end; $$;

-- Validate a drawn polygon around (lat0, lng0). Returns {pts (normalised jsonb), area, n} or raises invalid_area / too_far /
-- area_size / self_cross. Rules: 3–40 points, every point ≤ 60 m from the bar, 20–3000 m², the ring may not cross itself.
create or replace function public.olnu_area_check(p_poly jsonb, p_lat0 double precision, p_lng0 double precision)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  n int; i int; j int;
  x double precision[] := '{}'; y double precision[] := '{}';
  lo double precision; la double precision;
  kx double precision := 111195 * cos(radians(p_lat0)); ky double precision := 111195;
  a double precision := 0; pts jsonb := '[]'::jsonb;
  ax double precision; ay double precision; bx double precision; by_ double precision;
  cx double precision; cy double precision; dx double precision; dy double precision;
  d1 double precision; d2 double precision; d3 double precision; d4 double precision;
begin
  if p_poly is null or jsonb_typeof(p_poly) <> 'array' then raise exception 'invalid_area'; end if;
  n := jsonb_array_length(p_poly);
  if n >= 4 and p_poly -> 0 = p_poly -> (n - 1) then n := n - 1; end if;   -- closed ring given
  if n < 3 or n > 40 then raise exception 'invalid_area'; end if;
  for i in 0 .. n - 1 loop
    if jsonb_typeof(p_poly -> i) <> 'array' or jsonb_array_length(p_poly -> i) <> 2
       or jsonb_typeof(p_poly -> i -> 0) <> 'number' or jsonb_typeof(p_poly -> i -> 1) <> 'number' then
      raise exception 'invalid_area';
    end if;
    lo := round((p_poly -> i ->> 0)::numeric, 6)::float8; la := round((p_poly -> i ->> 1)::numeric, 6)::float8;
    if abs(la) > 85 or abs(lo) > 180 then raise exception 'invalid_area'; end if;
    x := x || ((lo - p_lng0) * kx); y := y || ((la - p_lat0) * ky);
    if sqrt(power(x[i + 1], 2) + power(y[i + 1], 2)) > 60 then raise exception 'too_far'; end if;
    pts := pts || jsonb_build_array(jsonb_build_array(lo, la));
  end loop;
  for i in 1 .. n loop
    j := case when i = n then 1 else i + 1 end;
    a := a + x[i] * y[j] - x[j] * y[i];
  end loop;
  a := abs(a) / 2;
  if a < 20 or a > 3000 then raise exception 'area_size'; end if;
  -- no two non-neighbour edges may cross (proper crossing or touching)
  for i in 1 .. n loop
    ax := x[i]; ay := y[i]; bx := x[case when i = n then 1 else i + 1 end]; by_ := y[case when i = n then 1 else i + 1 end];
    for j in i + 1 .. n loop
      if j = i + 1 or (i = 1 and j = n) then continue; end if;
      cx := x[j]; cy := y[j]; dx := x[case when j = n then 1 else j + 1 end]; dy := y[case when j = n then 1 else j + 1 end];
      d1 := (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      d2 := (dx - cx) * (by_ - cy) - (dy - cy) * (bx - cx);
      d3 := (bx - ax) * (cy - ay) - (by_ - ay) * (cx - ax);
      d4 := (bx - ax) * (dy - ay) - (by_ - ay) * (dx - ax);
      if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)) then
        raise exception 'self_cross';
      end if;
    end loop;
  end loop;
  return jsonb_build_object('pts', pts, 'area', round(a::numeric, 1), 'n', n);
end; $$;

-- Current approved area of each bar = the newest ok row that is not superseded.
create or replace function public.olnu_area_supersede(p_bar_id text, p_keep bigint)
returns void language sql security definer set search_path = public as $$
  update public.bar_areas a set superseded_at = now()
   where a.bar_id = p_bar_id and a.status = 'ok' and a.superseded_at is null and a.id <> p_keep;
$$;

create or replace function public.submit_bar_area(p_bar_id text, p_polygon jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_chk jsonb;
  v_trust boolean;
  v_id bigint;
  v_status text;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'unknown_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'unknown_bar'; end if;
  v_chk := public.olnu_area_check(p_polygon, v_pos[1], v_pos[2]);
  perform pg_advisory_xact_lock(hashtextextended('olnu-area:' || v_uid::text, 0));
  if (select count(*) from public.bar_areas a where a.created_by = v_uid and a.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'slow_down';
  end if;
  v_trust := exists (select 1 from public.bar_area_trusted t where t.user_id = v_uid and t.active);
  v_status := case when v_trust then 'ok' else 'pending' end;
  -- my older pending drafts of this bar are replaced by this one
  update public.bar_areas a set superseded_at = now()
   where a.created_by = v_uid and a.bar_id = p_bar_id and a.status = 'pending' and a.superseded_at is null;
  insert into public.bar_areas (bar_id, polygon, area_m2, n_pts, bar_lat, bar_lng, created_by, status, auto, status_at)
  values (p_bar_id, v_chk -> 'pts', (v_chk ->> 'area')::real, (v_chk ->> 'n')::int, v_pos[1], v_pos[2], v_uid, v_status, v_trust,
          case when v_trust then now() end)
  returning id into v_id;
  if v_trust then perform public.olnu_area_supersede(p_bar_id, v_id); end if;
  return jsonb_build_object('id', v_id, 'bar_id', p_bar_id, 'status', v_status, 'auto', v_trust, 'area_m2', (v_chk ->> 'area')::numeric,
                            'polygon', v_chk -> 'pts');
end; $$;

-- Approved areas whose bar lies in the box + my own pending ones there. Box max 0.5° × 1°.
create or replace function public.bar_areas_in(p_s double precision, p_w double precision, p_n double precision, p_e double precision)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if p_s is null or p_w is null or p_n is null or p_e is null or p_n < p_s or p_e < p_w
     or p_n - p_s > 0.5 or p_e - p_w > 1.0 then
    raise exception 'invalid_box';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'bar_id', a.bar_id, 'polygon', a.polygon, 'area_m2', a.area_m2,
             'status', a.status, 'mine', a.created_by = v_uid) order by a.id)
    from (select * from public.bar_areas x
           where x.superseded_at is null and x.bar_lat between p_s and p_n and x.bar_lng between p_w and p_e
             and (x.status = 'ok' or (x.status = 'pending' and x.created_by = v_uid))
           order by x.id desc limit 500) a), '[]'::jsonb);
end; $$;

-- Owner (stats.html, owner key): the list to review …
create or replace function public.owner_bar_areas(p_key text, p_status text default 'pending')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
                 select x.status s, count(*) n from public.bar_areas x where x.superseded_at is null group by 1) c),
    'trusted', (select count(*) from public.bar_area_trusted t where t.active),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'bar_id', a.bar_id, 'bar_lat', a.bar_lat, 'bar_lng', a.bar_lng,
                 'bar_name', (select b.name from public.bars_lite b where b.id = a.bar_id),
                 'polygon', a.polygon, 'area_m2', a.area_m2, 'n_pts', a.n_pts, 'status', a.status, 'auto', a.auto,
                 'created_at', a.created_at, 'superseded', a.superseded_at is not null,
                 'by_n', (select count(*) from public.bar_areas y where y.created_by = a.created_by),
                 'by_owner', exists (select 1 from public.bar_area_trusted t where t.user_id = a.created_by and t.active),
                 'others', (select count(*) from public.bar_areas z where z.bar_id = a.bar_id and z.id <> a.id and z.superseded_at is null))
               order by a.created_at desc)
              from (select * from public.bar_areas x
                     where (v_s = 'all' or x.status = v_s) and (x.superseded_at is null or v_s = 'all')
                     order by x.created_at desc limit 100) a), '[]'::jsonb));
end; $$;

-- … approve / reject (approving supersedes the bar's earlier approved area)
create or replace function public.owner_set_bar_area(p_key text, p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(btrim(coalesce(p_status, ''))); a public.bar_areas;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('pending', 'ok', 'rejected') then raise exception 'invalid_status'; end if;
  update public.bar_areas x set status = v_s, status_at = now(),
         superseded_at = case when v_s = 'ok' then null else x.superseded_at end
   where x.id = p_id returning * into a;
  if not found then raise exception 'area_not_found'; end if;
  if v_s = 'ok' then perform public.olnu_area_supersede(a.bar_id, a.id); end if;
  return jsonb_build_object('ok', true, 'id', a.id, 'status', v_s, 'bar_id', a.bar_id);
end; $$;

-- The owner's own app account: areas it draws are approved at once. Called from stats.html WITH the app session
-- (same origin, localStorage "olnu.auth") + the owner key. p_on = false switches it off again.
create or replace function public.owner_trust_me(p_key text, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_n int := 0; r record;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  insert into public.bar_area_trusted (user_id, active) values (v_uid, coalesce(p_on, true))
  on conflict (user_id) do update set active = excluded.active, updated_at = now();
  if coalesce(p_on, true) then
    for r in select x.id, x.bar_id from public.bar_areas x
              where x.created_by = v_uid and x.status = 'pending' and x.superseded_at is null order by x.id loop
      update public.bar_areas x set status = 'ok', auto = true, status_at = now() where x.id = r.id;
      perform public.olnu_area_supersede(r.bar_id, r.id);
      v_n := v_n + 1;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'trusted', coalesce(p_on, true), 'approved', v_n);
end; $$;

do $$
begin
  execute 'revoke all on function public.olnu_area_bar_pos(text), public.olnu_area_check(jsonb, double precision, double precision), public.olnu_area_supersede(text, bigint) from public';
  execute 'revoke all on function public.submit_bar_area(text, jsonb), public.bar_areas_in(double precision, double precision, double precision, double precision) from public';
  execute 'revoke all on function public.owner_bar_areas(text, text), public.owner_set_bar_area(text, bigint, text), public.owner_trust_me(text, boolean) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_area_bar_pos(text), public.olnu_area_check(jsonb, double precision, double precision), public.olnu_area_supersede(text, bigint) from anon';
    execute 'revoke all on function public.submit_bar_area(text, jsonb), public.bar_areas_in(double precision, double precision, double precision, double precision), public.owner_trust_me(text, boolean) from anon';
    -- owner panels run on stats.html with the anon key + the owner key (same as owner_places)
    execute 'grant execute on function public.owner_bar_areas(text, text), public.owner_set_bar_area(text, bigint, text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_area_bar_pos(text), public.olnu_area_check(jsonb, double precision, double precision), public.olnu_area_supersede(text, bigint) from authenticated';
    execute 'grant execute on function public.submit_bar_area(text, jsonb), public.bar_areas_in(double precision, double precision, double precision, double precision) to authenticated';
    execute 'grant execute on function public.owner_bar_areas(text, text), public.owner_set_bar_area(text, bigint, text), public.owner_trust_me(text, boolean) to authenticated';
  end if;
end $$;
