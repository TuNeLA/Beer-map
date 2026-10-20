-- Öl Nu v26 — 🐴 DEN GYLLENE DALAHÄSTEN. Additive.
-- About once per week per town a golden horse appears at one random bar in town (an evening Wed–Sat, 19–23 local,
-- until 02:00). The FIRST user who checks in at that bar while it is there catches it: medal `guldhast` (stacks)
-- and a 🐴 badge for 7 days. Rows are never removed.
-- Needs: olnu_uid, olnu_world_ok, olnu_town_of, olnu_towns, bars_lite, checkins, group_members, olnu_medal_store (0018).

create table if not exists public.golden_horses (
  id          bigserial primary key,
  town        text not null,
  week        date not null,                -- Monday (Europe/Stockholm)
  bar_id      text,                         -- null = no bar in this town (nothing appears this week)
  bar_name    text,
  lat         float8,
  lng         float8,
  appears_at  timestamptz,
  ends_at     timestamptz,
  claimed_by  uuid,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (town, week)
);
create index if not exists golden_horses_bar_ix on public.golden_horses (bar_id, appears_at);
create index if not exists golden_horses_claim_ix on public.golden_horses (claimed_by, claimed_at);
alter table public.golden_horses enable row level security;
revoke all on public.golden_horses from anon, authenticated;
revoke all on sequence public.golden_horses_id_seq from anon, authenticated;

-- This week's horse for a town (made on first ask; same row for everybody).
create or replace function public.olnu_gh_get(p_town text)
returns public.golden_horses language plpgsql security definer set search_path = public as $$
declare
  v_week date := date_trunc('week', now() at time zone 'Europe/Stockholm')::date;
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  g public.golden_horses; t record; b record; v_day date; v_at timestamptz; v_days date[];
begin
  select * into g from public.golden_horses h where h.town = p_town and h.week = v_week;
  if found then return g; end if;
  select x.name, x.lat, x.lng into t from public.olnu_towns x where x.name = p_town;
  if not found then return null; end if;
  select x.id, x.name, x.lat, x.lng into b from public.bars_lite x
   where x.active and x.type in ('bar', 'pub', 'nightclub', 'biergarten')
     and x.lat between t.lat - 0.04 and t.lat + 0.04 and x.lng between t.lng - 0.08 and t.lng + 0.08
   order by md5(x.id || ':' || v_week::text || ':olnu-gh') limit 1;
  -- Evenings left this week (Wed–Sat), else today (late in the week the horse still comes once).
  select array_agg(d::date order by d) into v_days from generate_series(greatest(v_today, v_week + 2), v_week + 5, interval '1 day') d;
  v_day := coalesce(v_days[1 + floor(random() * coalesce(array_length(v_days, 1), 1))::int], v_today);
  v_at := (v_day + make_time(19 + floor(random() * 4)::int, floor(random() * 60)::int, 0)) at time zone 'Europe/Stockholm';
  if v_at < now() then v_at := now() + make_interval(mins => 10 + floor(random() * 50)::int); end if;
  insert into public.golden_horses (town, week, bar_id, bar_name, lat, lng, appears_at, ends_at)
  values (p_town, v_week, b.id, left(b.name, 60), b.lat, b.lng, v_at,
          greatest(v_at + interval '2 hours', ((v_day + 1) + time '02:00') at time zone 'Europe/Stockholm'))
  on conflict (town, week) do nothing;
  select * into g from public.golden_horses h where h.town = p_town and h.week = v_week;
  return g;
end; $$;

-- Display name of p_user as p_viewer may see it (own: any group name; else a shared group's name; else null).
create or replace function public.olnu_gh_name(p_user uuid, p_viewer uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when p_user = p_viewer then (select min(m.display_name) from public.group_members m where m.user_id = p_user)
    else (select min(m.display_name) from public.group_members m join public.group_members v on v.group_id = m.group_id
           where m.user_id = p_user and v.user_id = p_viewer) end;
$$;

-- golden_horse(lat, lng) → jsonb {town, week, state 'none'|'waiting'|'live'|'claimed'|'gone', bar_id, bar_name, lat, lng,
--   appears_at (only live/claimed/gone), ends_at, claimed_at, winner_name, winner_mine, winner_known,
--   badges:[{name, is_me, until}] (caller + group-mates who caught a horse in the last 7 days), mine_total}
-- The bar is secret until the horse appears ('waiting' = it comes this week).
create or replace function public.golden_horse(p_lat float8 default null, p_lng float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_town text; g public.golden_horses; v_state text; v_out jsonb; v_badges jsonb;
begin
  if p_lat is not null and public.olnu_world_ok(p_lat, p_lng) then v_town := public.olnu_town_of(p_lat, p_lng); end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', public.olnu_gh_name(x.u, v_uid), 'is_me', x.u = v_uid, 'until', x.until) order by x.until desc), '[]'::jsonb)
    into v_badges
    from (select h.claimed_by u, max(h.claimed_at) + interval '7 days' until from public.golden_horses h
           where h.claimed_at > now() - interval '7 days' and h.claimed_by is not null
             and (h.claimed_by = v_uid or exists (select 1 from public.group_members a join public.group_members c on c.group_id = a.group_id
                                                   where a.user_id = h.claimed_by and c.user_id = v_uid))
           group by h.claimed_by) x;
  v_out := jsonb_build_object('v', 1, 'server_time', now(), 'badges', v_badges,
    'mine_total', (select count(*) from public.golden_horses h where h.claimed_by = v_uid));
  if v_town is null then return v_out || jsonb_build_object('state', 'none'); end if;
  g := public.olnu_gh_get(v_town);
  if g.id is null or g.bar_id is null then return v_out || jsonb_build_object('state', 'none', 'town', v_town); end if;
  v_state := case when g.claimed_by is not null then 'claimed' when now() < g.appears_at then 'waiting' when now() < g.ends_at then 'live' else 'gone' end;
  if v_state = 'waiting' then
    return v_out || jsonb_build_object('state', v_state, 'town', v_town, 'week', g.week);
  end if;
  return v_out || jsonb_build_object('state', v_state, 'town', v_town, 'week', g.week, 'id', g.id, 'bar_id', g.bar_id, 'bar_name', g.bar_name,
    'lat', g.lat, 'lng', g.lng, 'appears_at', g.appears_at, 'ends_at', g.ends_at, 'claimed_at', g.claimed_at,
    'winner_mine', g.claimed_by = v_uid, 'winner_name', case when g.claimed_by is null then null else public.olnu_gh_name(g.claimed_by, v_uid) end);
end; $$;

-- Check-in at a live horse's bar → the first one catches it. Never blocks the check-in.
create or replace function public.olnu_gh_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.bar_id is not null and (tg_op = 'INSERT' or new.bar_id is distinct from old.bar_id or new.created_at is distinct from old.created_at) then
      update public.golden_horses h set claimed_by = new.user_id, claimed_at = now()
       where h.bar_id = new.bar_id and h.claimed_by is null and h.appears_at <= now() and h.ends_at > now();
    end if;
  exception when others then null;
  end;
  return null;
end; $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'olnu_gh_checkin' and tgrelid = 'public.checkins'::regclass) then
    create trigger olnu_gh_checkin after insert or update on public.checkins
      for each row execute function public.olnu_gh_checkin_tg();
  end if;
end $$;

-- Medal (merged by the generic olnu_medal_store): guldhast = horses caught (stacks).
create or replace function public.olnu_medal_eval_golden(p_uid uuid)
returns table (medal text, n int) language sql stable security definer set search_path = public as $$
  select 'guldhast'::text, count(*)::int from public.golden_horses h where h.claimed_by = p_uid having count(*) > 0;
$$;

revoke all on function public.olnu_gh_get(text) from public, anon, authenticated;
revoke all on function public.olnu_gh_name(uuid, uuid) from public, anon, authenticated;
revoke all on function public.olnu_gh_checkin_tg() from public, anon, authenticated;
revoke all on function public.olnu_medal_eval_golden(uuid) from public, anon, authenticated;
revoke all on function public.golden_horse(float8, float8) from public, anon;
grant execute on function public.golden_horse(float8, float8) to authenticated;
grant all on public.golden_horses to service_role;
