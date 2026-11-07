-- 0221 🗺️ MAP ZONES · counts (owner 2026-11-07; additive, needs 0220). New RPC zone_counts(p_test) for the zoomed-out map:
-- people out tonight per kommun and per län, with the busiest kommun of each län and the busiest bar of each kommun.
-- Privacy:
--   * only counts leave the server, never a position; a pin is put in its kommun on the server (raw lat / lng, 600 m borders);
--   * the same people as the world counter (live, not stopped, ≥ 1 drink) MINUS 👻 spökläge pins and the test zone;
--   * a zone with 1–2 people has no number ("n" missing = "några" in the app); a 👑 line (top kommun / top bar) needs ≥ 3;
--   * zones with nobody are not listed.
-- Cost: built at most once per 60 s for everyone (olnu_zone_cache; one builder at a time, the others take the last row).
-- anon may call it (read-only map view without an account, CONTRACT "SPEED · konto vid första handling").
-- p_test = true only matters for a test user (olnu_is_test_user): the test zone is counted, own cache row, 5 s.

create or replace function public.olnu_kommun_of(p_lat double precision, p_lng double precision)
returns text language sql stable security definer set search_path to 'public' as $$
  -- inside a border; else (SCB's simplified coast: ~7 % of Swedish bars sit just outside, harbours, islands) the nearest
  -- kommun within ~3 km; else null (sea, abroad)
  select coalesce(
    (select z.kn from public.olnu_zone_poly z
      where p_lat is not null and p_lng is not null
        and z.bb @> point(p_lng, p_lat) and z.poly @> point(p_lng, p_lat)
      order by area(z.bb), z.kn
      limit 1),
    (select z.kn from public.olnu_zone_poly z
      where p_lat is not null and p_lng is not null
        and z.bb && box(point(p_lng - 0.06, p_lat - 0.03), point(p_lng + 0.06, p_lat + 0.03))
        and (z.poly <-> point(p_lng, p_lat)) < 0.03
      order by z.poly <-> point(p_lng, p_lat), z.kn
      limit 1));
$$;
revoke all on function public.olnu_kommun_of(double precision, double precision) from public, anon, authenticated;

create table if not exists public.olnu_zone_cache (
  id int primary key,
  at timestamptz not null,
  data jsonb not null
);
alter table public.olnu_zone_cache enable row level security;
revoke all on table public.olnu_zone_cache from public, anon, authenticated;

create or replace function public.olnu_zone_build(p_test boolean)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  k constant int := 3;   -- smallest number shown
  v jsonb;
begin
  with act as (
    select b.lat, b.lng, b.snap_bar
      from public.beers b
     where b.expires_at > now() and not b.stopped and not coalesce(b.ghost, false)
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and (p_test or not public.olnu_is_test_zone(b.lat, b.lng))
  ),
  pk as (select public.olnu_kommun_of(a.lat, a.lng) as kn, a.snap_bar from act a),
  kc as (select pk.kn, count(*)::int as n from pk where pk.kn is not null group by pk.kn),
  kb as (
    select distinct on (x.kn) x.kn, x.snap_bar as bar, x.n
      from (select pk.kn, pk.snap_bar, count(*)::int as n from pk where pk.kn is not null and pk.snap_bar is not null group by pk.kn, pk.snap_bar) x
     order by x.kn, x.n desc, x.snap_bar
  ),
  kl as (select kc.kn, kc.n, z.ln from kc join public.olnu_zone_kommun z on z.kn = kc.kn),
  lc as (select kl.ln, sum(kl.n)::int as n from kl group by kl.ln),
  lt as (select distinct on (kl.ln) kl.ln, kl.kn, kl.n from kl order by kl.ln, kl.n desc, kl.kn)
  select jsonb_build_object(
    'v', 1, 'at', now(), 'k', k,
    'total', (select case when sum(kc.n) >= k then sum(kc.n)::int end from kc),
    'some', (select count(*) > 0 from kc),
    'kommun', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'c', kc.kn,
                 'n', case when kc.n >= k then kc.n end,
                 'bar', case when kb.n >= k then kb.bar end)) order by kc.kn)
               from kc left join kb on kb.kn = kc.kn), '[]'::jsonb),
    'lan', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'c', lc.ln,
                 'n', case when lc.n >= k then lc.n end,
                 'top', case when lt.n >= k then lt.kn end)) order by lc.ln)
               from lc join lt on lt.ln = lc.ln), '[]'::jsonb))
    into v;
  return v;
end;
$$;
revoke all on function public.olnu_zone_build(boolean) from public, anon, authenticated;

create or replace function public.zone_counts(p_test boolean default false)
returns json language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_test boolean := coalesce(p_test, false) and public.olnu_is_test_user(auth.uid());
  v_id int := case when v_test then 2 else 1 end;
  v_ttl interval := case when v_test then interval '5 seconds' else interval '60 seconds' end;
  v jsonb;
begin
  select c.data into v from public.olnu_zone_cache c where c.id = v_id and c.at > now() - v_ttl;
  if v is not null then return v::json; end if;
  if not pg_try_advisory_xact_lock(873221, v_id) then   -- someone is building it right now: take the last one
    select c.data into v from public.olnu_zone_cache c where c.id = v_id;
    if v is not null then return v::json; end if;
  end if;
  v := public.olnu_zone_build(v_test);
  insert into public.olnu_zone_cache (id, at, data) values (v_id, now(), v)
  on conflict (id) do update set at = excluded.at, data = excluded.data;
  return v::json;
end;
$$;
revoke all on function public.zone_counts(boolean) from public;
grant execute on function public.zone_counts(boolean) to anon, authenticated;
