-- 0460 KPI · "Nyckeltal" (X9 key numbers) for the owner panel docs/stats.html (docs/stats-kpi.js). OWNER-RUN, AFTER 0430/0431.
-- Additive: two small helpers + one owner function. No statement removes rows or objects. Safe to run twice.
-- Needs pn_events (0330, already live): the file stops at once with a clear error if it is missing.
--
-- owner_kpi(p_key, p_days default 14) → jsonb, security definer, the same owner-key check as every owner_* function
-- (olnu_wd_owner_ok: after 0430 it uses olnu_sec_owner_limited(), the per-caller rate limit; a wrong key = 'forbidden').
-- "Night" = evening date, 05:00 → 05:00 Europe/Stockholm (pnlog_day; drink_log.night is the 05:00 END of the night).
-- Per night for the last p_days nights (14..28, default 14) + 'week' = the last 7 nights together:
--   su_anon / su_email   new users (auth.users.created_at) that are anonymous / have an e-mail account now
--   groups               groups made by a user (not DM threads or invite chats; creator not a test user)
--   out                  nights out: users with >= 1 drink_log row (beer, other drink or check-in, not undone)
--   act                  active users: a pn_events batch (app open, logging on) or a drink_log row that night
--   coh, d2, d7          returning users: cohort = sign-up night d0; D2 = active on d0 + 1, D7 = active on d0 + 7
--                        (null while that night has not come yet). week: the last 7 cohorts where the number is known.
--   beers_med            median beers per user per night, over users with >= 1 beer (owner only, never shown to users)
--   crashes, cpu         err.js + err.rej + crash.reload events (pnlog) and that per active pnlog user
--   push                 % of active users with a push subscription (subscriptions as they are now)
--   inv_sent, inv_yes    "Bjud in" invitations sent to a person (invite_people, not the creator) and answered yes
-- Privacy: counts only. No user ids, no names, no positions leave the function. A count of 1 or 2 is sent as the
-- string "<3"; a ratio or median built on 1 or 2 people is "<3" too. Test users are left out (olnu_kpi_tests below:
-- the same rules as olnu_is_test_uid, 0223, as one set instead of one call per user).
-- Cost: one pass over each source for the window; pn_events uses pn_events_day_idx; events are unpacked only for
-- batches that hold an error. No new index is needed. Timing (local Postgres 16, 2 busy CPUs): 4 000 users / 60 000
-- drink_log rows / 18 000 log batches = 0.10-0.16 s; 20 000 users / 300 000 rows / 90 000 batches = 0.6-0.9 s.
-- Check after the run (expect t):
--   select has_function_privilege('anon', 'public.owner_kpi(text,integer)', 'execute');

do $g$ begin
  if to_regclass('public.pn_events') is null then
    raise exception '0460: pn_events is missing. Run 0330 (and 0360) first.';
  end if;
end $g$;

-- 0 → 0, 1..2 → "<3", else the number
create or replace function public.olnu_kpi_m(n numeric)
returns jsonb language sql immutable set search_path to 'public' as $$
  select case when n is null then 'null'::jsonb when n between 1 and 2 then to_jsonb('<3'::text) else to_jsonb(n) end;
$$;
-- a / b * scale, rounded; "<3" when a or b is 1..2 (so a ratio never shows one or two people); null when b = 0
create or replace function public.olnu_kpi_r(a numeric, b numeric, scale numeric, digits int)
returns jsonb language sql immutable set search_path to 'public' as $$
  select case when a is null or b is null or b = 0 then 'null'::jsonb
              when a between 1 and 2 or b between 1 and 2 then to_jsonb('<3'::text)
              else to_jsonb(round(a * scale / b, digits)) end;
$$;
revoke all on function public.olnu_kpi_m(numeric) from public;
revoke all on function public.olnu_kpi_r(numeric, numeric, numeric, int) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_kpi_m(numeric) from anon, authenticated';
    execute 'revoke all on function public.olnu_kpi_r(numeric, numeric, numeric, int) from anon, authenticated';
  end if;
end $g$;

-- test users as a set (same rules as olnu_is_test_uid, 0223): metadata flag, olnu_test_users, or the CURRENT beer pin in the
-- test zone, else the check-in pin, else any push position. One pass per table instead of one call per user.
-- The box is the one in olnu_is_test_zone (68.25–68.45 N, 18.60–19.00 E), written out so the planner can inline it.
create or replace function public.olnu_kpi_tests()
returns table(id uuid) language sql stable security definer set search_path to 'public' as $$
  select u.id from auth.users u where coalesce(u.raw_user_meta_data ->> 'test', '') in ('true', '1')
  union select t.user_id from public.olnu_test_users t
  union select b.user_id from public.beers b where b.lat between 68.25 and 68.45 and b.lng between 18.60 and 19.00
  union select c.user_id from public.checkins c
         where c.lat between 68.25 and 68.45 and c.lng between 18.60 and 19.00 and not exists (select 1 from public.beers b where b.user_id = c.user_id)
  union select s.user_id from public.push_subscriptions s
         where s.lat is not null and s.lat between 68.25 and 68.45 and s.lng between 18.60 and 19.00
           and not exists (select 1 from public.beers b where b.user_id = s.user_id)
           and not exists (select 1 from public.checkins c where c.user_id = s.user_id);
$$;
revoke all on function public.olnu_kpi_tests() from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_kpi_tests() from anon, authenticated';
  end if;
end $g$;

create or replace function public.owner_kpi(p_key text, p_days int default 14)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  d int := least(greatest(coalesce(p_days, 14), 14), 28);
  v_today date := public.pnlog_day(now());
  v_from date;
  v_ts timestamptz;   -- start of the first night (05:00 Stockholm on v_from)
  r jsonb;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  v_from := v_today - (d - 1);
  v_ts := (v_from + interval '5 hours') at time zone 'Europe/Stockholm';

  with
  tst as materialized (select t.id from public.olnu_kpi_tests() t),
  su as materialized (
    select u.id, ((u.created_at at time zone 'Europe/Stockholm') - interval '5 hours')::date as day, (u.is_anonymous is true or u.email is null) as anon
      from auth.users u where u.created_at >= v_ts and u.id not in (select id from tst)),
  dl as materialized (
    select g.user_id, (g.night at time zone 'Europe/Stockholm')::date - 1 as day, count(*) filter (where g.kind = 'beer') as beers
      from public.drink_log g where g.night > v_ts and not g.undone and g.user_id not in (select id from tst)
     group by 1, 2),
  pen as materialized (
    select distinct x.day, x.user_id from public.pn_events x
     where x.day between v_from and v_today and x.user_id is not null and x.user_id not in (select id from tst)),
  -- active (user, night): a pnlog batch or a drink_log row
  act as materialized (select day, user_id from pen union select day, user_id from dl),
  pushu as materialized (select distinct s.user_id from public.push_subscriptions s),
  -- error / crash events, only unpacked for batches that hold one
  cr as (
    select x.day, count(*) as n
      from public.pn_events x cross join lateral jsonb_array_elements(x.ev) j
     where x.day between v_from and v_today and x.user_id is not null and jsonb_typeof(x.ev) = 'array'
       and (x.ev @> '[{"n":"err.js"}]' or x.ev @> '[{"n":"err.rej"}]' or x.ev @> '[{"n":"crash.reload"}]')
       and (j->>'n') in ('err.js', 'err.rej', 'crash.reload')
       and x.user_id not in (select id from tst)
     group by 1),
  coh as materialized (
    select s.day as d0, coalesce(bool_or(a.day = s.day + 1), false) as r2, coalesce(bool_or(a.day = s.day + 7), false) as r7
      from su s left join act a on a.user_id = s.id and a.day in (s.day + 1, s.day + 7)
     group by s.id, s.day),
  g_su as (select day, count(*) filter (where anon) as su_anon, count(*) filter (where not anon) as su_email from su group by 1),
  g_gr as (
    select ((g.created_at at time zone 'Europe/Stockholm') - interval '5 hours')::date as day, count(*) as n
      from public.groups g
     where g.created_at >= v_ts and g.created_by is not null   -- DM threads and invite chats are made with no creator
       and g.created_by not in (select id from tst)
       and not exists (select 1 from public.dm_threads t where t.group_id = g.id)
       and not exists (select 1 from public.temp_groups t where t.group_id = g.id)
     group by 1),
  g_dl as (
    select day, count(*) as out_n, count(*) filter (where beers > 0) as bp_n,
           percentile_cont(0.5) within group (order by beers) filter (where beers > 0) as beers_med
      from dl group by 1),
  g_act as (
    select a.day, count(*) as act_n, count(*) filter (where p.user_id is not null) as push_n
      from act a left join pushu p on p.user_id = a.user_id group by 1),
  g_pen as (select day, count(*) as pen_n from pen group by 1),
  g_coh as (select d0 as day, count(*) as coh_n, count(*) filter (where r2) as d2_n, count(*) filter (where r7) as d7_n from coh group by 1),
  g_ip as (
    select ((p.created_at at time zone 'Europe/Stockholm') - interval '5 hours')::date as day, count(*) as sent, count(*) filter (where p.answer = 'yes') as yes
      from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.created_at >= v_ts and p.user_id <> i.creator and i.creator not in (select id from tst)
     group by 1),
  per as (
    select y.day,
      coalesce(s.su_anon, 0) su_anon, coalesce(s.su_email, 0) su_email, coalesce(g.n, 0) as groups,
      coalesce(dd.out_n, 0) out_n, coalesce(dd.bp_n, 0) bp_n, dd.beers_med,
      coalesce(a.act_n, 0) act_n, coalesce(a.push_n, 0) push_n, coalesce(pe.pen_n, 0) pen_n,
      coalesce(c.coh_n, 0) coh_n,
      case when y.day + 1 <= v_today then coalesce(c.d2_n, 0) end as d2_n,
      case when y.day + 7 <= v_today then coalesce(c.d7_n, 0) end as d7_n,
      coalesce(cr.n, 0) as crashes, coalesce(ip.sent, 0) inv_sent, coalesce(ip.yes, 0) inv_yes
    from (select generate_series(v_from, v_today, interval '1 day')::date as day) y
    left join g_su s on s.day = y.day left join g_gr g on g.day = y.day left join g_dl dd on dd.day = y.day
    left join g_act a on a.day = y.day left join g_pen pe on pe.day = y.day left join g_coh c on c.day = y.day
    left join cr on cr.day = y.day left join g_ip ip on ip.day = y.day),
  wk as (
    select
      sum(su_anon) su_anon, sum(su_email) su_email, sum(groups) groups, sum(out_n) out_n, sum(crashes) crashes,
      sum(inv_sent) inv_sent, sum(inv_yes) inv_yes,
      (select count(distinct user_id) from dl where dl.day > v_today - 7) as people_out,
      (select count(distinct user_id) from act where act.day > v_today - 7) as act_n,
      (select count(distinct user_id) from pen where pen.day > v_today - 7) as pen_n,
      (select count(distinct a.user_id) from act a join pushu p on p.user_id = a.user_id where a.day > v_today - 7) as push_n,
      (select count(*) from dl where dl.day > v_today - 7 and dl.beers > 0) as bp_n,
      (select percentile_cont(0.5) within group (order by dl.beers) from dl where dl.day > v_today - 7 and dl.beers > 0) as beers_med,
      (select count(*) from coh where coh.d0 between v_today - 7 and v_today - 1) as coh2,
      (select count(*) from coh where coh.d0 between v_today - 7 and v_today - 1 and coh.r2) as d2_n,
      (select count(*) from coh where coh.d0 between v_today - 13 and v_today - 7) as coh7,
      (select count(*) from coh where coh.d0 between v_today - 13 and v_today - 7 and coh.r7) as d7_n
    from per where per.day > v_today - 7)
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'today', v_today,
    'days', d,
    'log_mode', public.pnlog_mode(),
    'rows', (select jsonb_agg(jsonb_build_object(
        'day', p.day,
        'su_anon', public.olnu_kpi_m(p.su_anon), 'su_email', public.olnu_kpi_m(p.su_email),
        'groups', public.olnu_kpi_m(p.groups),
        'out', public.olnu_kpi_m(p.out_n), 'act', public.olnu_kpi_m(p.act_n),
        'coh', public.olnu_kpi_m(p.coh_n),
        'd2', public.olnu_kpi_m(p.d2_n), 'd2_pct', public.olnu_kpi_r(p.d2_n, p.coh_n, 100, 0),
        'd7', public.olnu_kpi_m(p.d7_n), 'd7_pct', public.olnu_kpi_r(p.d7_n, p.coh_n, 100, 0),
        'beers_med', case when p.bp_n = 0 then 'null'::jsonb when p.bp_n < 3 then to_jsonb('<3'::text) else to_jsonb(round(p.beers_med::numeric, 1)) end,
        'crashes', public.olnu_kpi_m(p.crashes), 'cpu', public.olnu_kpi_r(p.crashes, p.pen_n, 1, 2),
        'push', public.olnu_kpi_r(p.push_n, p.act_n, 100, 0),
        'inv_sent', public.olnu_kpi_m(p.inv_sent), 'inv_yes', public.olnu_kpi_m(p.inv_yes)
      ) order by p.day desc) from per p),
    'week', (select jsonb_build_object(
        'su_anon', public.olnu_kpi_m(w.su_anon), 'su_email', public.olnu_kpi_m(w.su_email),
        'groups', public.olnu_kpi_m(w.groups),
        'out', public.olnu_kpi_m(w.out_n), 'people_out', public.olnu_kpi_m(w.people_out), 'act', public.olnu_kpi_m(w.act_n),
        'coh2', public.olnu_kpi_m(w.coh2), 'd2', public.olnu_kpi_m(w.d2_n), 'd2_pct', public.olnu_kpi_r(w.d2_n, w.coh2, 100, 0),
        'coh7', public.olnu_kpi_m(w.coh7), 'd7', public.olnu_kpi_m(w.d7_n), 'd7_pct', public.olnu_kpi_r(w.d7_n, w.coh7, 100, 0),
        'beers_med', case when w.bp_n = 0 then 'null'::jsonb when w.bp_n < 3 then to_jsonb('<3'::text) else to_jsonb(round(w.beers_med::numeric, 1)) end,
        'crashes', public.olnu_kpi_m(w.crashes), 'cpu', public.olnu_kpi_r(w.crashes, w.pen_n, 1, 2),
        'push', public.olnu_kpi_r(w.push_n, w.act_n, 100, 0),
        'inv_sent', public.olnu_kpi_m(w.inv_sent), 'inv_yes', public.olnu_kpi_m(w.inv_yes)
      ) from wk w)
  ) into r;
  return r;
end $$;
revoke all on function public.owner_kpi(text, int) from public;
grant execute on function public.owner_kpi(text, int) to anon, authenticated;
