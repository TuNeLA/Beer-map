-- Öl Nu: heat map closer to where each beer was drunk. Precise beers now snap to ~10 m cells
-- (was ~55 m). "Bara område" beers keep their ~550 m grid on purpose (privacy). Shots no longer count.
-- Same name, same return shape (COMPATIBILITY RULES). Safe to run again.
create or replace function public.heat_points()
returns table (lat float8, lng float8, w float8)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.olnu_uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select c.lat, c.lng, sum(c.w)::float8 as w
    from (
      select
        case when e.precise then (round(e.lat::numeric / 0.0001) * 0.0001)::float8 else e.lat end as lat,
        case when e.precise then (round(e.lng::numeric / 0.0002) * 0.0002)::float8 else e.lng end as lng,
        case when e.n >= 10 then 3
             when e.n >= 5 then 2
             else 1 end::float8 as w
      from public.beer_events e
      where e.expires_at > now() and e.kind = 'beer'
    ) c
    group by c.lat, c.lng
    order by w desc
    limit 5000;
end; $$;
revoke all on function public.heat_points() from public, anon;
grant execute on function public.heat_points() to authenticated;
