-- Öl Nu — 💰 user-reported prices per bar (CONTRACT "⏰ ÖPPETTIDER · 🍾 SYSTEMET · 💰 PRIS · 🚪 ENTRÉ · 🌭 NATTMAT").
-- LEGAL (Alkohollagen 2010:1622, 7 kap. "särskild måttfullhet"): prices are neutral information shown on the bar sheet and,
-- when the user switches it on, as a small tag on bar markers. No push, no ticker, no "cheapest" ranking, no medal.
-- One row per user, bar, kind and Stockholm day (a second report the same day corrects the first). Shown price = the median of
-- the newest report of each of the last 7 users within 120 days. Additive: one new table + functions; rows are never removed.

create table if not exists public.bar_prices (
  id         bigserial primary key,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  user_id    uuid not null,
  kind       text not null check (kind in ('stor', 'cider', 'drink')),
  kr         int not null check (kr between 20 and 300),
  day        date not null,
  bar_lat    double precision not null,
  bar_lng    double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bar_id, user_id, kind, day)
);
create index if not exists bar_prices_bar_idx on public.bar_prices (bar_id, kind, updated_at desc);
create index if not exists bar_prices_pos_idx on public.bar_prices (bar_lat, bar_lng) where kind = 'stor';
create index if not exists bar_prices_user_idx on public.bar_prices (user_id, updated_at desc);
alter table public.bar_prices enable row level security;
revoke all on public.bar_prices from anon, authenticated;
revoke all on sequence public.bar_prices_id_seq from anon, authenticated;
grant all on public.bar_prices to service_role;

-- {kr (median, whole kr), n (users), at (newest)} of one bar and kind, or null.
create or replace function public.olnu_aio_price(p_bar_id text, p_kind text)
returns jsonb language sql stable security definer set search_path = public as $$
  with per_user as (
    select distinct on (p.user_id) p.kr, p.updated_at
      from public.bar_prices p
     where p.bar_id = p_bar_id and p.kind = p_kind and p.updated_at > now() - interval '120 days'
     order by p.user_id, p.updated_at desc
  ), recent as (select * from per_user order by updated_at desc limit 7)
  select case when count(*) = 0 then null else
    jsonb_build_object('kr', round(percentile_cont(0.5) within group (order by kr))::int, 'n', count(*), 'at', max(updated_at)) end
    from recent;
$$;

create or replace function public.report_bar_price(p_bar_id text, p_kind text, p_kr int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_day date := (now() at time zone 'Europe/Stockholm')::date;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  if v_kind not in ('stor', 'cider', 'drink') then raise exception 'invalid_kind'; end if;
  if p_kr is null or p_kr < 20 or p_kr > 300 then raise exception 'invalid_price'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-price:' || v_uid::text, 0));
  if (select count(*) from public.bar_prices p where p.user_id = v_uid and p.updated_at > now() - interval '24 hours') >= 30 then
    raise exception 'slow_down';
  end if;
  insert into public.bar_prices (bar_id, user_id, kind, kr, day, bar_lat, bar_lng)
  values (p_bar_id, v_uid, v_kind, p_kr, v_day, v_pos[1], v_pos[2])
  on conflict (bar_id, user_id, kind, day) do update set kr = excluded.kr, updated_at = now();
  return jsonb_build_object('ok', true, 'bar_id', p_bar_id, 'kind', v_kind, 'mine', p_kr, 'price', public.olnu_aio_price(p_bar_id, v_kind));
end; $$;

-- Stor stark price tags for the map: bars in the box (max 0.5° × 1°) with a report in 120 days. Max 400.
create or replace function public.bar_prices_in(p_s double precision, p_w double precision, p_n double precision, p_e double precision)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if p_s is null or p_w is null or p_n is null or p_e is null or p_n < p_s or p_e < p_w
     or p_n - p_s > 0.5 or p_e - p_w > 1.0 then
    raise exception 'invalid_box';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('bar_id', b.bar_id) || public.olnu_aio_price(b.bar_id, 'stor'))
    from (select distinct p.bar_id from public.bar_prices p
           where p.kind = 'stor' and p.bar_lat between p_s and p_n and p.bar_lng between p_w and p_e
             and p.updated_at > now() - interval '120 days'
           limit 400) b), '[]'::jsonb);
end; $$;

do $$
begin
  execute 'revoke all on function public.olnu_aio_price(text, text), public.report_bar_price(text, text, int), public.bar_prices_in(double precision, double precision, double precision, double precision) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_aio_price(text, text), public.report_bar_price(text, text, int), public.bar_prices_in(double precision, double precision, double precision, double precision) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_aio_price(text, text) from authenticated';
    execute 'grant execute on function public.report_bar_price(text, text, int), public.bar_prices_in(double precision, double precision, double precision, double precision) to authenticated';
  end if;
end $$;
