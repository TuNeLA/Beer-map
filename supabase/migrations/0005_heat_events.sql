-- v6: heat map shows where each beer was drunk, not only where people are now.
-- Additive only (COMPATIBILITY RULES): new table, new trigger, new RPC. post_beer, post_shot and
-- live_beers are unchanged, so old app versions keep working. Safe to re-run.
--
-- Each accepted beer or shot adds one row to beer_events at the place it was logged.
-- The row has NO user_id: it is an anonymous dot for the heat map. Rows live until the
-- same 05:00 expiry as the beer pin.

create table if not exists public.beer_events (
  id         bigserial primary key,
  kind       text not null check (kind in ('beer', 'shot')),
  lat        float8 not null,
  lng        float8 not null,
  precise    boolean not null default false,
  n          int not null default 1,          -- beer number tonight (for streak weight); 0 for shots
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists beer_events_expires_idx on public.beer_events (expires_at);
alter table public.beer_events enable row level security;
-- No policies: only SECURITY DEFINER functions touch this table.
revoke all on table public.beer_events from public, anon, authenticated;

-- Trigger on beers: log a heat event when beer_count or shot_count goes up.
-- post_beer / post_shot delete an expired row before they insert a new one, so a new night
-- always starts with an INSERT.
create or replace function public.olnu_log_beer_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_beers int := 0;
  v_old_shots int := 0;
begin
  if tg_op = 'UPDATE' then
    v_old_beers := coalesce(old.beer_count, 0);
    v_old_shots := coalesce(old.shot_count, 0);
  end if;
  if coalesce(new.beer_count, 0) > v_old_beers then
    insert into public.beer_events (kind, lat, lng, precise, n, expires_at)
    values ('beer', new.lat, new.lng, coalesce(new.precise, false), new.beer_count, new.expires_at);
  end if;
  if coalesce(new.shot_count, 0) > v_old_shots then
    insert into public.beer_events (kind, lat, lng, precise, n, expires_at)
    values ('shot', new.lat, new.lng, coalesce(new.precise, false), 0, new.expires_at);
  end if;
  -- Light cleanup of old nights.
  if random() < 0.05 then
    delete from public.beer_events where expires_at < now() - interval '2 days';
  end if;
  return new;
end; $$;
revoke all on function public.olnu_log_beer_event() from public, anon, authenticated;

drop trigger if exists olnu_beer_event on public.beers;
create trigger olnu_beer_event
  after insert or update of beer_count, shot_count on public.beers
  for each row execute function public.olnu_log_beer_event();

-- heat_points: tonight's beers grouped into small map cells.
-- Precise events snap to about 55 m cells, approximate events keep their ~550 m grid.
-- Weight per beer: 1 (beers 1–4), 2 (HOT STREAK, 5–9), 3 (MEDEVAC, 10+). Shot = 0.5.
create or replace function public.heat_points()
returns table (lat float8, lng float8, w float8)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.olnu_uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select c.lat, c.lng, sum(c.w)::float8 as w
    from (
      select
        case when e.precise then (round(e.lat::numeric / 0.0005) * 0.0005)::float8 else e.lat end as lat,
        case when e.precise then (round(e.lng::numeric / 0.001) * 0.001)::float8 else e.lng end as lng,
        case when e.kind = 'shot' then 0.5
             when e.n >= 10 then 3
             when e.n >= 5 then 2
             else 1 end::float8 as w
      from public.beer_events e
      where e.expires_at > now()
    ) c
    group by c.lat, c.lng
    order by w desc
    limit 5000;
end; $$;
revoke all on function public.heat_points() from public, anon;
grant execute on function public.heat_points() to authenticated;

-- Seed tonight: one event per beer for pins that already exist, at their current place,
-- so the heat map is not empty right after the migration. Only runs when the table is empty.
insert into public.beer_events (kind, lat, lng, precise, n, expires_at)
select 'beer', b.lat, b.lng, b.precise, g.n, b.expires_at
from public.beers b
cross join lateral generate_series(1, greatest(b.beer_count, 0)) as g(n)
where b.expires_at > now() and not b.stopped
  and not exists (select 1 from public.beer_events);
