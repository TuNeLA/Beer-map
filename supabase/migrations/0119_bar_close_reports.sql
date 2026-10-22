-- Öl Nu — ⏰ "🕐 Fel tider?" (CONTRACT "⏰ ÖPPETTIDER · 🍾 SYSTEMET · 💰 PRIS · 🚪 ENTRÉ · 🌭 NATTMAT").
-- Opening hours come from OpenStreetMap (docs/hours.json, scripts/fetch-hours.mjs). Users can say when a bar really closes TONIGHT:
-- the newest report of the night wins for everyone, until 05:00. Additive: one new table + functions. Rows are never removed;
-- every read filters on the night.
-- Needs olnu_uid, olnu_night_of, olnu_evening, olnu_area_bar_pos (0095).

create table if not exists public.bar_close_reports (
  id         bigserial primary key,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  user_id    uuid not null,
  evening    date not null,                                  -- olnu_evening(olnu_night_of(now()))
  close_min  int not null check (close_min between 960 and 1800),   -- minutes after the evening's 00:00 (01:30 = 1530)
  closed     boolean not null default false,                 -- "Stängt ikväll"
  bar_lat    double precision not null,
  bar_lng    double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists bar_close_reports_bar_idx on public.bar_close_reports (bar_id, evening, created_at desc);
create index if not exists bar_close_reports_user_idx on public.bar_close_reports (user_id, created_at desc);
alter table public.bar_close_reports enable row level security;
revoke all on public.bar_close_reports from anon, authenticated;
revoke all on sequence public.bar_close_reports_id_seq from anon, authenticated;
grant all on public.bar_close_reports to service_role;

create or replace function public.olnu_aio_evening()
returns date language sql stable set search_path = public as $$
  select public.olnu_evening(public.olnu_night_of(now()));
$$;

-- p_close 'HH:MM' (16:00–06:00; 00:00–06:00 = after midnight) or 'closed'.
create or replace function public.report_bar_close(p_bar_id text, p_close text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_ev date := public.olnu_aio_evening();
  v_m text[]; v_min int; v_closed boolean := false;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  if lower(btrim(coalesce(p_close, ''))) = 'closed' then
    v_closed := true; v_min := 960;
  else
    v_m := regexp_match(btrim(coalesce(p_close, '')), '^(\d{1,2})[:.](\d{2})$');
    if v_m is null or v_m[1]::int > 23 or v_m[2]::int > 59 then raise exception 'invalid_time'; end if;
    v_min := v_m[1]::int * 60 + v_m[2]::int;
    if v_min <= 360 then v_min := v_min + 1440; end if;      -- 00:00–06:00 = after midnight
    if v_min < 960 or v_min > 1800 then raise exception 'invalid_time'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-close:' || v_uid::text, 0));
  if (select count(*) from public.bar_close_reports r where r.user_id = v_uid and r.created_at > now() - interval '24 hours') >= 12 then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from public.bar_close_reports r where r.user_id = v_uid and r.bar_id = p_bar_id and r.created_at > now() - interval '60 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.bar_close_reports (bar_id, user_id, evening, close_min, closed, bar_lat, bar_lng)
  values (p_bar_id, v_uid, v_ev, v_min, v_closed, v_pos[1], v_pos[2]);
  return jsonb_build_object('ok', true, 'bar_id', p_bar_id, 'close_min', v_min, 'closed', v_closed, 'evening', v_ev);
end; $$;

-- Tonight's reported closing time of one bar (newest report wins) or null.
create or replace function public.olnu_aio_close(p_bar_id text, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('min', r.close_min, 'closed', r.closed, 'at', r.created_at, 'mine', r.user_id = p_uid,
           'n', (select count(*) from public.bar_close_reports x where x.bar_id = p_bar_id and x.evening = r.evening))
    from public.bar_close_reports r
   where r.bar_id = p_bar_id and r.evening = public.olnu_aio_evening()
   order by r.created_at desc limit 1;
$$;

do $$
begin
  execute 'revoke all on function public.olnu_aio_evening(), public.olnu_aio_close(text, uuid), public.report_bar_close(text, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_aio_evening(), public.olnu_aio_close(text, uuid), public.report_bar_close(text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_aio_evening(), public.olnu_aio_close(text, uuid) from authenticated';
    execute 'grant execute on function public.report_bar_close(text, text) to authenticated';
  end if;
end $$;
