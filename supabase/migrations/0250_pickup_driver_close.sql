-- 0250 PintsNow (agent feat, 2026-11-07). ADDITIVE ONLY: 4 new tables, new RPCs. No old table, RPC or policy changes.
--   1. 🆘 Hämta mig: "Kan nån hämta mig?" + my position to the friends / groups I pick (olnu_inv_resolve, max 30).
--      Position shared 15–120 min (default 60) or until I stop. One live request per person. Rate: 60 s between starts,
--      max 6 per 12 h. Answers: "kommer" (Jag kommer) / "kan_inte".
--        pickup_start(p_lat, p_lng, p_acc, p_keys, p_group_ids, p_minutes, p_name) → mine
--        pickup_ping(p_id, p_lat, p_lng, p_acc) → {ok, live}       (max every 5 s)
--        pickup_stop(p_id) → {ok}                                   (position cleared)
--        pickup_answer(p_id, p_ans) → {ok, ans}
--        pickup_poll() → {v, mine, incoming[], driving}
--   2. 🚗 Jag kör ikväll: driver_set(p_on) (tonight only, olnu_night_of), drivers_for(p_group_id) → [{k, name, is_me}],
--      ride_ask(p_group_id, p_k, p_lat, p_lng, p_name) → a 'skjuts' request to that one driver (same table as 1).
--      Never counted as drinking: nothing here touches beers / drink_log / meriter.
--   3. ⏰ Baren stänger: close_remind_set(p_bar_id, p_bar_name, p_close_at) / close_remind_clear() (the app sets it while
--      I am checked in and the bar's hours are known), close_remind_claim() service_role only (notify-group cron sends
--      "stänger om 20 / 10 min"; the push kind is gated by push_prefs + nattro in notify-group).
--   Pushes ({event:"pickup"|"pickup_yes", req_id}) need the notify-group update (owner deploys). Without it the app still
--   shows everything in-app (poll).
--   Account delete: every table references auth.users on delete cascade.

-- ---------- tables ----------
create table if not exists public.pickup_reqs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('hamta', 'skjuts')),
  to_users uuid[] not null default '{}',
  group_id uuid,
  lat double precision, lng double precision, acc int, pos_at timestamptz,
  created_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  end_reason text,
  notified boolean not null default false
);
create index if not exists pickup_reqs_user_idx on public.pickup_reqs (user_id, created_at desc);
create index if not exists pickup_reqs_live_idx on public.pickup_reqs (ends_at) where ended_at is null;
create index if not exists pickup_reqs_to_idx on public.pickup_reqs using gin (to_users);
alter table public.pickup_reqs enable row level security;
revoke all on table public.pickup_reqs from public, anon, authenticated;

create table if not exists public.pickup_answers (
  req_id bigint not null references public.pickup_reqs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ans text not null check (ans in ('kommer', 'kan_inte')),
  at timestamptz not null default now(),
  notified boolean not null default false,
  primary key (req_id, user_id)
);
alter table public.pickup_answers enable row level security;
revoke all on table public.pickup_answers from public, anon, authenticated;

create table if not exists public.driver_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  night timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.driver_status enable row level security;
revoke all on table public.driver_status from public, anon, authenticated;

create table if not exists public.close_reminders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bar_id text not null check (char_length(bar_id) between 1 and 80),
  bar_name text,
  close_at timestamptz not null,
  sent20 boolean not null default false,
  sent10 boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.close_reminders enable row level security;
revoke all on table public.close_reminders from public, anon, authenticated;

-- ---------- helpers ----------
create or replace function public.olnu_pickup_sweep()
returns void language sql security definer set search_path = public as $$
  update public.pickup_reqs set ended_at = ends_at, end_reason = 'timeout', lat = null, lng = null, acc = null
   where ended_at is null and ends_at < now();
$$;

create or replace function public.olnu_pickup_okpos(p_lat double precision, p_lng double precision)
returns boolean language sql immutable set search_path = public as $$
  select p_lat is not null and p_lng is not null and p_lat = p_lat and p_lng = p_lng and abs(p_lat) <= 85 and abs(p_lng) <= 180;
$$;

create or replace function public.olnu_pickup_mine(r public.pickup_reqs)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'kind', r.kind, 'live', r.ended_at is null and r.ends_at > now(),
    'created_at', r.created_at, 'ends_at', r.ends_at, 'ended_at', r.ended_at, 'end_reason', r.end_reason,
    'n', coalesce(array_length(r.to_users, 1), 0), 'has_pos', r.lat is not null,
    'driver', case when r.kind = 'skjuts' then public.olnu_walk_name(r.to_users[1], r.group_id) end,
    'answers', coalesce((select jsonb_agg(jsonb_build_object('name', public.olnu_walk_name(a.user_id, r.group_id), 'ans', a.ans, 'at', a.at)
                          order by (a.ans = 'kommer') desc, a.at)
                          from public.pickup_answers a where a.req_id = r.id), '[]'::jsonb));
$$;

-- ---------- 1. Hämta mig ----------
create or replace function public.pickup_start(
  p_lat double precision default null, p_lng double precision default null, p_acc double precision default null,
  p_keys text[] default '{}', p_group_ids uuid[] default '{}', p_minutes int default 60, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_to uuid[]; v_ok boolean; v_gid uuid; v_min int; r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  v_ok := public.olnu_pickup_okpos(p_lat, p_lng);
  perform pg_advisory_xact_lock(hashtextextended('olnu-pickup:' || v_uid::text, 0));
  if exists (select 1 from public.pickup_reqs x where x.user_id = v_uid and x.created_at > now() - interval '60 seconds')
     or (select count(*) from public.pickup_reqs x where x.user_id = v_uid and x.created_at > now() - interval '12 hours') >= 6 then
    raise exception 'slow_down';
  end if;
  v_to := public.olnu_inv_resolve(v_uid, p_keys, p_group_ids);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_to from unnest(v_to) u where u <> v_uid and not public.olnu_ub_hidden(v_uid, u);
  if coalesce(array_length(v_to, 1), 0) = 0 then raise exception 'no_viewers'; end if;
  if array_length(v_to, 1) > 30 then raise exception 'too_many'; end if;
  if coalesce(array_length(p_group_ids, 1), 0) = 1 and not public.olnu_is_temp_group(p_group_ids[1]) then v_gid := p_group_ids[1]; end if;
  v_min := greatest(15, least(120, coalesce(p_minutes, 60)));
  perform public.olnu_pickup_sweep();
  update public.pickup_reqs set ended_at = now(), end_reason = 'replaced', lat = null, lng = null, acc = null
   where user_id = v_uid and ended_at is null;
  insert into public.pickup_reqs (user_id, kind, to_users, group_id, lat, lng, acc, pos_at, ends_at)
  values (v_uid, 'hamta', v_to, v_gid,
          case when v_ok then round(p_lat::numeric, 5)::float8 end, case when v_ok then round(p_lng::numeric, 5)::float8 end,
          case when v_ok and p_acc is not null and p_acc = p_acc then least(9999, greatest(0, round(p_acc)))::int end,
          case when v_ok then now() end, now() + make_interval(mins => v_min))
  returning * into r;
  return public.olnu_pickup_mine(r);
end; $$;

create or replace function public.pickup_ping(p_id bigint, p_lat double precision, p_lng double precision, p_acc double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_pickup_okpos(p_lat, p_lng) then raise exception 'invalid_position'; end if;
  perform public.olnu_pickup_sweep();
  select * into r from public.pickup_reqs x where x.id = p_id and x.user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is null and (r.pos_at is null or r.pos_at < now() - interval '5 seconds') then
    update public.pickup_reqs set lat = round(p_lat::numeric, 5)::float8, lng = round(p_lng::numeric, 5)::float8,
           acc = case when p_acc is not null and p_acc = p_acc then least(9999, greatest(0, round(p_acc)))::int end, pos_at = now()
     where id = r.id;
  end if;
  return jsonb_build_object('ok', true, 'live', r.ended_at is null);
end; $$;

create or replace function public.pickup_stop(p_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.pickup_reqs set ended_at = now(), end_reason = 'stop', lat = null, lng = null, acc = null
   where user_id = v_uid and ended_at is null and (p_id is null or id = p_id);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.pickup_answer(p_id bigint, p_ans text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_ans text := lower(trim(coalesce(p_ans, '')));
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_ans not in ('kommer', 'kan_inte') then raise exception 'invalid_answer'; end if;
  perform public.olnu_pickup_sweep();
  select * into r from public.pickup_reqs x where x.id = p_id and v_uid = any (x.to_users);
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null then raise exception 'ended'; end if;
  if exists (select 1 from public.pickup_answers a where a.req_id = p_id and a.user_id = v_uid and a.at > now() - interval '2 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.pickup_answers (req_id, user_id, ans, at) values (p_id, v_uid, v_ans, now())
  on conflict (req_id, user_id) do update set ans = excluded.ans, at = now(),
    notified = case when public.pickup_answers.ans = excluded.ans then public.pickup_answers.notified else false end;
  return jsonb_build_object('ok', true, 'ans', v_ans);
end; $$;

create or replace function public.pickup_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_mine jsonb; v_in jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_pickup_sweep();
  select public.olnu_pickup_mine(x) into v_mine from public.pickup_reqs x
   where x.user_id = v_uid and (x.ended_at is null or x.ended_at > now() - interval '10 minutes')
   order by x.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'kind', x.kind, 'name', public.olnu_walk_name(x.user_id, x.group_id),
           'live', x.ended_at is null,
           'lat', case when x.ended_at is null then x.lat end, 'lng', case when x.ended_at is null then x.lng end,
           'acc', case when x.ended_at is null then x.acc end, 'pos_at', x.pos_at,
           'created_at', x.created_at, 'ends_at', x.ends_at, 'ended_at', x.ended_at, 'end_reason', x.end_reason,
           'my_ans', (select a.ans from public.pickup_answers a where a.req_id = x.id and a.user_id = v_uid),
           'coming', (select count(*) from public.pickup_answers a where a.req_id = x.id and a.ans = 'kommer'))
         order by x.created_at desc), '[]'::jsonb)
    into v_in
    from (select * from public.pickup_reqs x
           where v_uid = any (x.to_users) and x.user_id <> v_uid and not public.olnu_ub_hidden(v_uid, x.user_id)
             and (x.ended_at is null or x.ended_at > now() - interval '15 minutes')
           order by x.created_at desc limit 10) x;
  return jsonb_build_object('v', 1, 'now', now(), 'mine', v_mine, 'incoming', v_in,
    'driving', exists (select 1 from public.driver_status d where d.user_id = v_uid and d.night = public.olnu_night_of(now())));
end; $$;

-- ---------- 2. Jag kör ikväll ----------
create or replace function public.driver_set(p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-driver:' || v_uid::text, 0));
  if exists (select 1 from public.driver_status d where d.user_id = v_uid and d.updated_at > now() - interval '1 second') then
    raise exception 'slow_down';
  end if;
  if coalesce(p_on, false) then
    insert into public.driver_status (user_id, night, updated_at) values (v_uid, v_night, now())
    on conflict (user_id) do update set night = excluded.night, updated_at = now();
  else
    -- "off" = a night that is already over (no row is removed; the row is overwritten next time)
    update public.driver_status set night = v_night - interval '1 day', updated_at = now() where user_id = v_uid;
  end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, false));
end; $$;

create or replace function public.drivers_for(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_group_id is null or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_chief_k(p_group_id, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = v_uid) order by (m.user_id = v_uid) desc, m.display_name), '[]'::jsonb)
    into v
    from public.group_members m join public.driver_status d on d.user_id = m.user_id and d.night = public.olnu_night_of(now())
   where m.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, m.user_id);
  return jsonb_build_object('v', 1, 'drivers', v);
end; $$;

create or replace function public.ride_ask(p_group_id uuid, p_k text, p_lat double precision default null,
  p_lng double precision default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_drv uuid; v_ok boolean; r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_group_id is null or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select m.user_id into v_drv from public.group_members m
    join public.driver_status d on d.user_id = m.user_id and d.night = public.olnu_night_of(now())
   where m.group_id = p_group_id and public.olnu_chief_k(p_group_id, m.user_id) = p_k limit 1;
  if v_drv is null or v_drv = v_uid or public.olnu_ub_hidden(v_uid, v_drv) then raise exception 'not_driving'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-pickup:' || v_uid::text, 0));
  if exists (select 1 from public.pickup_reqs x where x.user_id = v_uid and x.kind = 'skjuts' and x.to_users = array[v_drv]
               and x.created_at > now() - interval '3 minutes')
     or (select count(*) from public.pickup_reqs x where x.user_id = v_uid and x.created_at > now() - interval '12 hours') >= 12 then
    raise exception 'slow_down';
  end if;
  v_ok := public.olnu_pickup_okpos(p_lat, p_lng);
  perform public.olnu_pickup_sweep();
  update public.pickup_reqs set ended_at = now(), end_reason = 'replaced', lat = null, lng = null, acc = null
   where user_id = v_uid and ended_at is null;
  insert into public.pickup_reqs (user_id, kind, to_users, group_id, lat, lng, pos_at, ends_at)
  values (v_uid, 'skjuts', array[v_drv], case when public.olnu_is_temp_group(p_group_id) then null else p_group_id end,
          case when v_ok then round(p_lat::numeric, 5)::float8 end, case when v_ok then round(p_lng::numeric, 5)::float8 end,
          case when v_ok then now() end, now() + interval '60 minutes')
  returning * into r;
  return public.olnu_pickup_mine(r);
end; $$;

-- ---------- 3. Baren stänger ----------
create or replace function public.close_remind_set(p_bar_id text, p_bar_name text, p_close_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_name text := left(nullif(trim(coalesce(p_bar_name, '')), ''), 60);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  if p_close_at is null or p_close_at < now() + interval '1 minute' or p_close_at > now() + interval '8 hours' then
    raise exception 'invalid_time';
  end if;
  insert into public.close_reminders (user_id, bar_id, bar_name, close_at, updated_at)
  values (v_uid, p_bar_id, v_name, date_trunc('minute', p_close_at), now())
  on conflict (user_id) do update set
    sent20 = case when public.close_reminders.bar_id = excluded.bar_id
                   and abs(extract(epoch from public.close_reminders.close_at - excluded.close_at)) < 120 then public.close_reminders.sent20 else false end,
    sent10 = case when public.close_reminders.bar_id = excluded.bar_id
                   and abs(extract(epoch from public.close_reminders.close_at - excluded.close_at)) < 120 then public.close_reminders.sent10 else false end,
    bar_id = excluded.bar_id, bar_name = excluded.bar_name, close_at = excluded.close_at, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.close_remind_clear()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.close_reminders set sent20 = true, sent10 = true, updated_at = now() where user_id = v_uid;
  return jsonb_build_object('ok', true);
end; $$;

-- service_role (notify-group cron): claim every due stage once. 20-min stage: 12–25 min left. 10-min stage: 0–12 min left.
-- Only while the person is still checked in at that bar.
create or replace function public.close_remind_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with c as (
    update public.close_reminders r
       set sent10 = r.sent10 or r.close_at <= now() + interval '12 minutes', sent20 = true, updated_at = now()
     where r.close_at > now() and r.close_at <= now() + interval '25 minutes'
       and ((not r.sent20 and r.close_at > now() + interval '12 minutes') or (not r.sent10 and r.close_at <= now() + interval '12 minutes'))
       and exists (select 1 from public.checkins ci where ci.user_id = r.user_id and ci.bar_id = r.bar_id and ci.expires_at > now())
    returning r.user_id, r.bar_id, r.bar_name, r.close_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('to', c.user_id, 'bar_id', c.bar_id, 'bar_name', c.bar_name, 'close_at', c.close_at,
           'min', greatest(1, ceil(extract(epoch from c.close_at - now()) / 60)::int))), '[]'::jsonb)
    into v from c;
  return v;
end; $$;

-- ---------- grants ----------
do $$
declare
  v_int text := 'public.olnu_pickup_sweep(), public.olnu_pickup_okpos(double precision, double precision), public.olnu_pickup_mine(public.pickup_reqs)';
  v_user text := 'public.pickup_start(double precision, double precision, double precision, text[], uuid[], integer, text), '
              || 'public.pickup_ping(bigint, double precision, double precision, double precision), public.pickup_stop(bigint), '
              || 'public.pickup_answer(bigint, text), public.pickup_poll(), public.driver_set(boolean), public.drivers_for(uuid), '
              || 'public.ride_ask(uuid, text, double precision, double precision, text), '
              || 'public.close_remind_set(text, text, timestamptz), public.close_remind_clear()';
  v_svc text := 'public.close_remind_claim()';
begin
  execute 'revoke all on function ' || v_int || ', ' || v_user || ', ' || v_svc || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_int || ', ' || v_user || ', ' || v_svc || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_int || ', ' || v_svc || ' from authenticated';
    execute 'grant execute on function ' || v_user || ' to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ' || v_svc || ' to service_role';
  end if;
end $$;
