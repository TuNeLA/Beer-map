-- 0313 ⏱️ "HÖR AV MIG NÄR JAG ÄR HEMMA" (competitor research idea 7, Watcher / Noonlight / Apple Check In). Additive only.
-- An OPTIONAL timer on a Följ mig hem walk (0141). The walker picks 20 / 40 / 60 min. When the time is up and the walker
-- has not said "Hemma", the walker gets "Är du hemma?" (stage 'remind'). No answer 30 s after that → the chosen
-- viewers get an alert with the last position (stage 'alert'). 📞 Ring 112 stays first in every sheet.
-- The stages move forward whenever ANYONE involved polls (walker or viewer: walk_timer_tick, every 15 s while a timer
-- is live in an open app) and in the notify-group cron (walk_timer_due_claim, every 10 min = the fallback when no app
-- is open: then the alert can come up to ~20 min late; said in the UI).
--   walk_timer_set(p_walk_id, p_minutes)  walker: start / extend (10–110 min, from now). Resets remind / alert.
--   walk_timer_ok(p_walk_id)              walker: "Allt OK / Hemma" (ends the timer).
--   walk_timer_tick()                     walker or viewer: advance the stages; returns {mine, alerts, push}
--   walk_timer_push_claim(p_walk_id)      service_role (notify-group {event:"walk_check"}): stages not pushed yet
--   walk_timer_due_claim(p_limit)         service_role (cron): advance all + claim every stage not pushed yet
-- A walk that ends 'home' = OK; ended by the walker ('stop' / 'replaced') = cancelled; 'timeout' keeps the timer.
-- The last position is copied from the live walk on every advance (walks clears its position when the walk ends).
-- No row is ever removed. Safe to run again.

create table if not exists public.gw_walk_timers (
  walk_id       bigint primary key,
  user_id       uuid not null,
  minutes       int not null,
  due_at        timestamptz not null,
  reminded_at   timestamptz,
  alert_at      timestamptz,
  ok_at         timestamptz,
  cancelled_at  timestamptz,
  last_lat      double precision,
  last_lng      double precision,
  last_at       timestamptz,
  remind_pushed boolean not null default false,
  alert_pushed  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists gw_walk_timers_open on public.gw_walk_timers (due_at) where ok_at is null and cancelled_at is null;
alter table public.gw_walk_timers enable row level security;
revoke all on table public.gw_walk_timers from public, anon, authenticated;

-- Move every open timer (p_walk null = all of them; else that walk only) one step. 30 s answer window after the reminder.
create or replace function public.olnu_gw_walk_advance(p_walk bigint default null)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
begin
  update public.gw_walk_timers t set
      ok_at = case when w.end_reason = 'home' then coalesce(w.ended_at, now()) else t.ok_at end,
      cancelled_at = case when coalesce(w.end_reason, '') in ('stop', 'replaced') and t.alert_at is null then coalesce(w.ended_at, now()) else t.cancelled_at end,
      last_lat = case when w.ended_at is null and w.lat is not null then round(w.lat::numeric, 4)::float8 else t.last_lat end,
      last_lng = case when w.ended_at is null and w.lng is not null then round(w.lng::numeric, 4)::float8 else t.last_lng end,
      last_at  = case when w.ended_at is null and w.lat is not null then coalesce(w.pos_at, now()) else t.last_at end,
      reminded_at = case when coalesce(w.end_reason, '') not in ('home', 'stop', 'replaced')
                          and t.reminded_at is null and now() >= t.due_at then now() else t.reminded_at end,
      alert_at = case when coalesce(w.end_reason, '') not in ('home', 'stop', 'replaced')
                       and t.alert_at is null and t.reminded_at is not null and now() >= t.reminded_at + interval '30 seconds' then now() else t.alert_at end,
      updated_at = now()
    from public.walks w
   where w.id = t.walk_id and t.ok_at is null and t.cancelled_at is null and t.created_at > now() - interval '6 hours'
     and (p_walk is null or t.walk_id = p_walk);
end $$;

create or replace function public.olnu_gw_walk_state(t public.gw_walk_timers)
returns jsonb language sql stable set search_path to 'public' as $$
  select jsonb_build_object('walk_id', t.walk_id, 'minutes', t.minutes, 'due_at', t.due_at, 'reminded_at', t.reminded_at,
    'alert_at', t.alert_at, 'ok_at', t.ok_at, 'cancelled_at', t.cancelled_at, 'now', now(),
    'left_s', greatest(0, ceil(extract(epoch from (t.due_at - now()))))::int,
    'answer_s', case when t.reminded_at is not null and t.alert_at is null
                     then greatest(0, ceil(extract(epoch from (t.reminded_at + interval '30 seconds' - now()))))::int end);
$$;

create or replace function public.walk_timer_set(p_walk_id bigint, p_minutes int)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); w public.walks; t public.gw_walk_timers; v_m int := coalesce(p_minutes, 0);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_m < 10 or v_m > 110 then raise exception 'invalid_minutes'; end if;
  select * into w from public.walks x where x.id = p_walk_id and x.user_id = v_uid;
  if w.id is null or w.ended_at is not null then raise exception 'walk_not_found'; end if;
  if exists (select 1 from public.gw_walk_timers x where x.walk_id = w.id and x.updated_at > now() - interval '2 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.gw_walk_timers as x (walk_id, user_id, minutes, due_at)
  values (w.id, v_uid, v_m, now() + make_interval(mins => v_m))
  on conflict (walk_id) do update set minutes = excluded.minutes, due_at = excluded.due_at, reminded_at = null,
    alert_at = null, ok_at = null, cancelled_at = null,
    remind_pushed = false, alert_pushed = false, updated_at = now()
  returning * into t;
  return public.olnu_gw_walk_state(t);
end $$;

create or replace function public.walk_timer_ok(p_walk_id bigint)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); t public.gw_walk_timers;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.gw_walk_timers x set ok_at = coalesce(x.ok_at, now()), updated_at = now()
   where x.walk_id = p_walk_id and x.user_id = v_uid returning * into t;
  if t.walk_id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true) || public.olnu_gw_walk_state(t);
end $$;

create or replace function public.walk_timer_tick()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.olnu_uid(); r record; v_mine jsonb; v_alerts jsonb; v_push jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  for r in
    select t.walk_id from public.gw_walk_timers t join public.walks w on w.id = t.walk_id
     where (t.user_id = v_uid or v_uid = any (w.viewers)) and t.ok_at is null and t.cancelled_at is null
       and t.created_at > now() - interval '6 hours'
     limit 20
  loop
    perform public.olnu_gw_walk_advance(r.walk_id);
    if exists (select 1 from public.gw_walk_timers t where t.walk_id = r.walk_id
                and ((t.reminded_at is not null and not t.remind_pushed) or (t.alert_at is not null and not t.alert_pushed))) then
      v_push := v_push || to_jsonb(r.walk_id);
    end if;
  end loop;
  select public.olnu_gw_walk_state(t) into v_mine from public.gw_walk_timers t
   where t.user_id = v_uid and t.created_at > now() - interval '6 hours' and t.ok_at is null and t.cancelled_at is null
   order by t.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('walk_id', t.walk_id,
           'name', public.olnu_card_first(public.olnu_gw_name_for(t.user_id, v_uid)),
           'due_at', t.due_at, 'alert_at', t.alert_at, 'last_lat', t.last_lat, 'last_lng', t.last_lng, 'last_at', t.last_at,
           'ok_at', t.ok_at) order by t.alert_at desc), '[]'::jsonb)
    into v_alerts
    from public.gw_walk_timers t join public.walks w on w.id = t.walk_id
   where v_uid = any (w.viewers) and t.user_id <> v_uid and t.alert_at is not null and t.alert_at > now() - interval '3 hours';
  return jsonb_build_object('v', 1, 'mine', v_mine, 'alerts', v_alerts, 'push', v_push);
end $$;

-- service_role: claim the stages of one walk (or of all walks) that were not pushed yet. One UPDATE per flag.
create or replace function public.olnu_gw_walk_claim(p_walk bigint, p_limit int)
returns table (walk_id bigint, stage text, user_id uuid, viewers uuid[], name text, due_at timestamptz,
               last_lat double precision, last_lng double precision, last_at timestamptz)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  return query
  with c as (
    update public.gw_walk_timers t set remind_pushed = true, updated_at = now()
     where t.reminded_at is not null and not t.remind_pushed and t.alert_at is null and t.ok_at is null and t.cancelled_at is null
       and (p_walk is null or t.walk_id = p_walk) and t.reminded_at > now() - interval '2 hours'
       and t.walk_id in (select x.walk_id from public.gw_walk_timers x where x.reminded_at is not null and not x.remind_pushed
                          and (p_walk is null or x.walk_id = p_walk) order by x.reminded_at limit greatest(1, least(100, coalesce(p_limit, 50))))
    returning t.walk_id, 'remind'::text as stage, t.user_id, t.due_at, t.last_lat, t.last_lng, t.last_at
  ), a as (
    update public.gw_walk_timers t set alert_pushed = true, remind_pushed = true, updated_at = now()
     where t.alert_at is not null and not t.alert_pushed and t.ok_at is null and t.cancelled_at is null
       and (p_walk is null or t.walk_id = p_walk) and t.alert_at > now() - interval '2 hours'
       and t.walk_id in (select x.walk_id from public.gw_walk_timers x where x.alert_at is not null and not x.alert_pushed
                          and (p_walk is null or x.walk_id = p_walk) order by x.alert_at limit greatest(1, least(100, coalesce(p_limit, 50))))
    returning t.walk_id, 'alert'::text as stage, t.user_id, t.due_at, t.last_lat, t.last_lng, t.last_at
  )
  select z.walk_id, z.stage, z.user_id, w.viewers, public.olnu_card_first(public.olnu_gw_name_for(z.user_id, null)),
         z.due_at, z.last_lat, z.last_lng, z.last_at
    from (select * from c union all select * from a) z join public.walks w on w.id = z.walk_id;
end $$;

create or replace function public.walk_timer_push_claim(p_walk_id bigint)
returns table (walk_id bigint, stage text, user_id uuid, viewers uuid[], name text, due_at timestamptz,
               last_lat double precision, last_lng double precision, last_at timestamptz)
language plpgsql volatile security definer set search_path to 'public' as $$
begin
  if p_walk_id is null then return; end if;
  perform public.olnu_gw_walk_advance(p_walk_id);
  return query select * from public.olnu_gw_walk_claim(p_walk_id, 5);
end $$;

create or replace function public.walk_timer_due_claim(p_limit int default 50)
returns table (walk_id bigint, stage text, user_id uuid, viewers uuid[], name text, due_at timestamptz,
               last_lat double precision, last_lng double precision, last_at timestamptz)
language plpgsql volatile security definer set search_path to 'public' as $$
begin
  perform public.olnu_gw_walk_advance(null);
  return query select * from public.olnu_gw_walk_claim(null, p_limit);
end $$;

revoke all on function public.olnu_gw_walk_advance(bigint) from public, anon, authenticated;
revoke all on function public.olnu_gw_walk_state(public.gw_walk_timers) from public, anon, authenticated;
revoke all on function public.olnu_gw_walk_claim(bigint, int) from public, anon, authenticated;
revoke all on function public.walk_timer_set(bigint, int) from public, anon;
revoke all on function public.walk_timer_ok(bigint) from public, anon;
revoke all on function public.walk_timer_tick() from public, anon;
revoke all on function public.walk_timer_push_claim(bigint) from public, anon, authenticated;
revoke all on function public.walk_timer_due_claim(int) from public, anon, authenticated;
grant execute on function public.walk_timer_set(bigint, int) to authenticated;
grant execute on function public.walk_timer_ok(bigint) to authenticated;
grant execute on function public.walk_timer_tick() to authenticated;
grant execute on function public.walk_timer_push_claim(bigint) to service_role;
grant execute on function public.walk_timer_due_claim(int) to service_role;
