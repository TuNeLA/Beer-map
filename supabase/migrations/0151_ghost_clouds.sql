-- 0151 ☁️ ghost clouds (owner 2026-10-22): last days' anonymous beers as soft clouds that fade with age.
-- Additive. ghost_points() keeps its shape (lat, lng, w) and now covers 1–3 days ago (was 1–8).
-- New ghost_points2() = the same cells + age_h (beer-weighted mean age in hours) so the client can fade each cloud.
-- Same privacy rules as 0015: heat cells only (bar point / ~55 m cell / ~550 m grid), a ~55 m cell with < 3 beers
-- goes to the ~550 m grid, undone beers left out, nothing from the last 24 h (that is the live map).

create or replace function public.ghost_points()
returns table (lat float8, lng float8, w float8)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.olnu_uid();
  return query
  with cells as (
    select e.hlat as clat, e.hlng as clng, e.hkind as k, count(*) as cn
      from public.beer_events e
     where e.kind = 'beer'
       and not e.undone
       and e.hlat is not null
       and e.created_at >= now() - interval '3 days'
       and e.created_at <  now() - interval '1 day'
     group by e.hlat, e.hlng, e.hkind
  )
  select x.slat, x.slng, sum(x.cn)::float8 as cw
    from (select case when c.k = 2 and c.cn < 3 then round(c.clat * 200) / 200.0 else c.clat end as slat,
                 case when c.k = 2 and c.cn < 3 then round(c.clng * 100) / 100.0 else c.clng end as slng,
                 c.cn
            from cells c) x
   group by x.slat, x.slng
   order by cw desc
   limit 5000;
end;
$$;

create or replace function public.ghost_points2()
returns table (lat float8, lng float8, w float8, age_h float8)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.olnu_uid();
  return query
  with cells as (
    select e.hlat as clat, e.hlng as clng, e.hkind as k, count(*) as cn,
           avg(extract(epoch from (now() - e.created_at)) / 3600.0) as ah
      from public.beer_events e
     where e.kind = 'beer'
       and not e.undone
       and e.hlat is not null
       and e.created_at >= now() - interval '3 days'
       and e.created_at <  now() - interval '1 day'
     group by e.hlat, e.hlng, e.hkind
  )
  select x.slat, x.slng, sum(x.cn)::float8 as cw, round((sum(x.cn * x.ah) / sum(x.cn))::numeric, 1)::float8 as cage
    from (select case when c.k = 2 and c.cn < 3 then round(c.clat * 200) / 200.0 else c.clat end as slat,
                 case when c.k = 2 and c.cn < 3 then round(c.clng * 100) / 100.0 else c.clng end as slng,
                 c.cn, c.ah
            from cells c) x
   group by x.slat, x.slng
   order by cw desc
   limit 5000;
end;
$$;

revoke all on function public.ghost_points() from public;
revoke all on function public.ghost_points2() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ghost_points() from anon';
    execute 'revoke all on function public.ghost_points2() from anon';
  end if;
end $$;
grant execute on function public.ghost_points() to authenticated;
grant execute on function public.ghost_points2() to authenticated;
