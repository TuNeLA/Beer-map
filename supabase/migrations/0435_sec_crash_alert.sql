-- 0435 SEC (X7) · CRASH ALERT TO THE OWNER'S PHONE. OWNER-RUN at release. Flag OFF by default.
-- Run order: after 0430 (any place after 0330/0360, which made pn_events and client_vitals). Needs the notify-group
-- patch sec-patches/02-notify-group-crash-alert.py deployed (the existing notify-group cron, every 10 min, calls
-- crash_alert_claim()). Without the patch nothing is sent and nothing breaks.
--
-- What counts as a crash: a distinct real (not test) user in the last hour with a JS error (pn_events 'err.js'),
-- an unhandled promise rejection ('err.rej'), a crash reload ('crash.reload'), or a client_vitals row with errors > 0.
-- RPC errors ('err.rpc': slow_down, offline …) do NOT count; they are normal.
-- Rule: when MORE than min_users (default 5) distinct users crashed in the last hour, ONE push goes to the owner's
-- account only, then nothing for cooldown_min (default 180 = 3 h). Nobody else is ever notified.
-- Who is the owner: sec_crash_alert.owner_uid (set by owner_crash_alert(..., p_this_phone => true) from the owner's
-- own app session, or by SQL). When it is empty: the newest active row in bar_area_trusted (the phone the owner marked
-- "📱 Den här mobilen är min" with the owner key, 0095 owner_trust_me). No owner found = nothing is sent.
-- Additive only: one table, three functions. No row-removing or object-removing statement.

create table if not exists public.sec_crash_alert (
  id            int primary key default 1 check (id = 1),
  on_           boolean not null default false,
  min_users     int not null default 5 check (min_users between 1 and 100000),
  cooldown_min  int not null default 180 check (cooldown_min between 10 and 10080),
  owner_uid     uuid,
  last_sent_at  timestamptz,
  last_users    int,
  last_top      text,
  updated_at    timestamptz not null default now()
);
alter table public.sec_crash_alert enable row level security;   -- no policies: only the functions below
revoke all on public.sec_crash_alert from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.sec_crash_alert from anon, authenticated';
  end if;
end $g$;
insert into public.sec_crash_alert (id) values (1) on conflict (id) do nothing;

-- distinct crashed users since p_since (+ the most common first error line, max 80 chars, no user data)
create or replace function public.olnu_crash_users(p_since timestamptz)
returns table(users int, top text) language sql stable security definer set search_path to 'public' as $$
  with e as (
    select x.user_id, coalesce(j -> 'p' ->> 'm', j ->> 'n') as m
      from public.pn_events x
      cross join lateral jsonb_array_elements(case when jsonb_typeof(x.ev) = 'array' then x.ev else '[]'::jsonb end) j
     where x.day >= public.pnlog_day(p_since) and x.at > p_since and x.user_id is not null
       and (j ->> 'n') in ('err.js', 'err.rej', 'crash.reload')
    union all
    select c.user_id, coalesce(nullif(c.err_first, ''), 'vitals') as m
      from public.client_vitals c
     where c.created_at > p_since and coalesce(c.errors, 0) > 0 and c.user_id is not null
  ), r as (
    select e.user_id, e.m from e where not public.olnu_is_test_uid(e.user_id)
  )
  select (select count(distinct r.user_id) from r)::int,
         (select left(r.m, 80) from r group by r.m order by count(distinct r.user_id) desc, r.m limit 1);
$$;
revoke all on function public.olnu_crash_users(timestamptz) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_crash_users(timestamptz) from anon, authenticated';
  end if;
end $g$;

-- notify-group cron (service role only): one claim = one decision. send = true at most once per cooldown.
create or replace function public.crash_alert_claim()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  s public.sec_crash_alert;
  v_owner uuid;
  v_users int; v_top text;
begin
  select * into s from public.sec_crash_alert where id = 1 for update;
  if not found or not s.on_ then return jsonb_build_object('send', false, 'why', 'off'); end if;
  if s.last_sent_at is not null and s.last_sent_at > now() - make_interval(mins => s.cooldown_min) then
    return jsonb_build_object('send', false, 'why', 'cooldown', 'last_sent_at', s.last_sent_at);
  end if;
  v_owner := coalesce(s.owner_uid,
    (select t.user_id from public.bar_area_trusted t where t.active order by t.updated_at desc nulls last limit 1));
  if v_owner is null then return jsonb_build_object('send', false, 'why', 'no_owner'); end if;
  select c.users, c.top into v_users, v_top from public.olnu_crash_users(now() - interval '1 hour') c;
  if coalesce(v_users, 0) <= s.min_users then
    return jsonb_build_object('send', false, 'why', 'below', 'users', coalesce(v_users, 0), 'min_users', s.min_users);
  end if;
  update public.sec_crash_alert set last_sent_at = now(), last_users = v_users, last_top = v_top where id = 1;
  return jsonb_build_object('send', true, 'owner', v_owner, 'users', v_users, 'top', v_top, 'min_users', s.min_users);
end $$;
revoke all on function public.crash_alert_claim() from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.crash_alert_claim() from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.crash_alert_claim() to service_role';
  end if;
end $g$;

-- owner switch (stats.html or SQL): same owner key check as every owner_* function.
-- p_this_phone = true: alerts go to the account of the session that calls (call it from the owner's own phone
-- with the app session, like owner_trust_me). Every argument is optional: null = keep.
create or replace function public.owner_crash_alert(p_key text, p_on boolean default null, p_min_users int default null,
                                                    p_cooldown_min int default null, p_this_phone boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.sec_crash_alert; c record;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if p_min_users is not null and (p_min_users < 1 or p_min_users > 100000) then raise exception 'invalid_min_users'; end if;
  if p_cooldown_min is not null and (p_cooldown_min < 10 or p_cooldown_min > 10080) then raise exception 'invalid_cooldown'; end if;
  if coalesce(p_this_phone, false) and auth.uid() is null then raise exception 'no_session'; end if;
  update public.sec_crash_alert x
     set on_ = coalesce(p_on, x.on_), min_users = coalesce(p_min_users, x.min_users),
         cooldown_min = coalesce(p_cooldown_min, x.cooldown_min),
         owner_uid = case when coalesce(p_this_phone, false) then auth.uid() else x.owner_uid end,
         updated_at = now()
   where x.id = 1
   returning * into s;
  select * into c from public.olnu_crash_users(now() - interval '1 hour');
  return jsonb_build_object('on', s.on_, 'min_users', s.min_users, 'cooldown_min', s.cooldown_min,
    'owner_set', s.owner_uid is not null,
    'owner_fallback', s.owner_uid is null and exists (select 1 from public.bar_area_trusted t where t.active),
    'last_sent_at', s.last_sent_at, 'last_users', s.last_users, 'users_last_hour', coalesce(c.users, 0), 'top', c.top);
end $$;
revoke all on function public.owner_crash_alert(text, boolean, int, int, boolean) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.owner_crash_alert(text, boolean, int, int, boolean) to anon, authenticated';
  end if;
end $g$;
