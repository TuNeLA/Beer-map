-- public.olnu_zone_build(p_test boolean)
-- live md5(pg_get_functiondef) = ed97574a2c7ffbe45cf06139af5957ea
CREATE OR REPLACE FUNCTION public.olnu_zone_build(p_test boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
