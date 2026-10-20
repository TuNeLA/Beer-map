-- 0051 v27 HELGSTREAK. Client: docs/js/helg.js (window.HELG) + docs/helg.css. Push: notify-group {event:"helg_remind"}.
-- Personal weekly streak: a week (Monday-Sunday, evening date Europe/Stockholm) counts when you were out at least
-- one night with the evening on Friday, Saturday or Sunday. A drink or a check-in both count (medal_nights,
-- medal_checkins, after_nights). Freeze passes: everyone starts with 2; a missed week with a streak > 0 uses one
-- automatically (the streak stays, it does not grow); while you have fewer than 2 you get one back every 4 weeks.
-- Group streak: a group week counts when 3 or more current members were out that weekend (no freezes).
-- Everything is computed from existing fact tables (no new history table). Rows are never removed.
-- Needs 0001-0035 (medal_nights, medal_checkins, after_nights, group_members, push_sent, olnu_night_of,
-- olnu_evening, olnu_uid). RLS: no new tables. RPCs: SECURITY DEFINER, search_path public, authenticated only.
-- helg_remind_targets is for the edge function (service_role only).
-- Test clock: setting olnu.helg_now (SQL editor only). Safe to run again.

create or replace function public.olnu_helg_now()
returns timestamptz language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('olnu.helg_now', true), '')::timestamptz, now());
$$;

-- Monday of the week of the current night's evening (Monday 00:00-05:00 still belongs to last week).
create or replace function public.olnu_helg_week(p_now timestamptz)
returns date language sql stable set search_path = public as $$
  select date_trunc('week', public.olnu_evening(public.olnu_night_of(p_now))::timestamp)::date;
$$;

-- Weeks (Mondays) in which the user was out on a Friday, Saturday or Sunday evening.
create or replace function public.olnu_helg_weeks(p_uid uuid)
returns table (week date)
language sql stable security definer set search_path = public as $$
  select distinct date_trunc('week', x.ev::timestamp)::date
    from (select public.olnu_evening(mn.night) as ev from public.medal_nights mn
           where mn.user_id = p_uid and mn.beers + mn.others > 0
          union
          select public.olnu_evening(mc.night) from public.medal_checkins mc where mc.user_id = p_uid
          union
          select public.olnu_evening(an.night) from public.after_nights an
           where an.user_id = p_uid and (an.out or an.checkins > 0)) x
   where extract(isodow from x.ev) in (5, 6, 7);
$$;

-- Personal streak state: {streak, best, freezes, done, at_risk, next_freeze_in, week, used, weeks:[{w, s}]}
-- s: 'out' | 'frozen' | 'miss' | 'now' (current week, not out yet) | 'now_out'.
create or replace function public.olnu_helg_calc(p_uid uuid, p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cur    date := public.olnu_helg_week(p_now);
  v_weeks  date[];
  v_w      date;
  v_streak int := 0;
  v_best   int := 0;
  v_fr     int := 2;
  v_since  int := 0;
  v_used   int := 0;
  v_done   boolean;
  v_hist   jsonb := '[]'::jsonb;
  v_s      text;
begin
  select coalesce(array_agg(w.week order by w.week), '{}') into v_weeks from public.olnu_helg_weeks(p_uid) w
   where w.week <= v_cur and w.week >= v_cur - 728;   -- two years is plenty
  v_done := v_cur = any (v_weeks);
  if array_length(v_weeks, 1) is not null then
    v_w := v_weeks[1];
    while v_w < v_cur loop
      if v_w = any (v_weeks) then
        v_streak := v_streak + 1; v_s := 'out';
      elsif v_streak > 0 and v_fr > 0 then
        v_fr := v_fr - 1; v_used := v_used + 1; v_s := 'frozen';
      else
        v_streak := 0; v_s := 'miss';
      end if;
      v_best := greatest(v_best, v_streak);
      if v_fr < 2 then
        v_since := v_since + 1;
        if v_since >= 4 then v_fr := v_fr + 1; v_since := 0; end if;
      else
        v_since := 0;
      end if;
      if v_w >= v_cur - 49 then v_hist := v_hist || jsonb_build_array(jsonb_build_object('w', v_w, 's', v_s)); end if;
      v_w := v_w + 7;
    end loop;
  end if;
  v_hist := v_hist || jsonb_build_array(jsonb_build_object('w', v_cur, 's', case when v_done then 'now_out' else 'now' end));
  if v_done then v_streak := v_streak + 1; end if;
  v_best := greatest(v_best, v_streak);
  return jsonb_build_object(
    'week', v_cur, 'streak', v_streak, 'best', v_best, 'freezes', v_fr, 'max_freezes', 2, 'used', v_used,
    'done', v_done, 'at_risk', (not v_done) and v_streak > 0 and v_fr = 0,
    'will_freeze', (not v_done) and v_streak > 0 and v_fr > 0,
    'next_freeze_in', case when v_fr < 2 then 4 - v_since else null end,
    'weeks', v_hist);
end;
$$;

-- Group streak over the last 52 weeks: {streak, best, this_week, need, done, weeks:[{w, n}]}
create or replace function public.olnu_helg_group(p_gid uuid, p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cur    date := public.olnu_helg_week(p_now);
  v_from   date := public.olnu_helg_week(p_now) - 364;
  v_counts jsonb := '{}'::jsonb;
  v_w      date;
  v_n      int;
  v_streak int := 0;
  v_best   int := 0;
  v_this   int := 0;
  v_hist   jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_object_agg(x.week::text, x.n), '{}'::jsonb) into v_counts
    from (select w.week, count(distinct gm.user_id)::int as n
            from public.group_members gm, lateral public.olnu_helg_weeks(gm.user_id) w
           where gm.group_id = p_gid and w.week between v_from and v_cur
           group by w.week) x;
  v_w := v_from;
  while v_w < v_cur loop
    v_n := coalesce((v_counts->>(v_w::text))::int, 0);
    if v_n >= 3 then v_streak := v_streak + 1; else v_streak := 0; end if;
    v_best := greatest(v_best, v_streak);
    if v_w >= v_cur - 49 then v_hist := v_hist || jsonb_build_array(jsonb_build_object('w', v_w, 'n', v_n)); end if;
    v_w := v_w + 7;
  end loop;
  v_this := coalesce((v_counts->>(v_cur::text))::int, 0);
  v_hist := v_hist || jsonb_build_array(jsonb_build_object('w', v_cur, 'n', v_this, 'now', true));
  if v_this >= 3 then v_streak := v_streak + 1; end if;
  v_best := greatest(v_best, v_streak);
  return jsonb_build_object('week', v_cur, 'streak', v_streak, 'best', v_best, 'this_week', v_this, 'need', 3,
    'done', v_this >= 3, 'members', (select count(*) from public.group_members gm where gm.group_id = p_gid),
    'weeks', v_hist);
end;
$$;

-- helg_state() -> {v, now, week, weekend, friday_evening, me, groups:[{id, name, ...group streak}]} (max 20 groups)
create or replace function public.helg_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_helg_now();
  v_loc timestamp := v_now at time zone 'Europe/Stockholm';
  v_ev  date := public.olnu_evening(public.olnu_night_of(v_now));
  v_gs  jsonb := '[]'::jsonb;
  r record;
begin
  for r in select g.id, g.name from public.group_members gm join public.groups g on g.id = gm.group_id
            where gm.user_id = v_uid order by gm.joined_at limit 20 loop
    v_gs := v_gs || jsonb_build_array(jsonb_build_object('id', r.id, 'name', r.name) || public.olnu_helg_group(r.id, v_now));
  end loop;
  return jsonb_build_object('v', 1, 'now', v_now, 'week', public.olnu_helg_week(v_now),
    'weekend', extract(isodow from v_ev) in (5, 6, 7),
    'friday_evening', extract(isodow from v_loc) = 5 and extract(hour from v_loc) >= 17,
    'me', public.olnu_helg_calc(v_uid, v_now), 'groups', v_gs);
end;
$$;

-- For notify-group {event:"helg_remind"} (service_role only). Friday 17:00-23:59 Europe/Stockholm only.
-- Returns group-mates of the caller (not the caller) whose streak would break this weekend (streak > 0, no
-- freeze left, not out yet) and claims them in push_sent (kind 'helg', night = the week's Monday) so each user
-- gets at most 1 reminder per week, whoever triggers it.
create or replace function public.helg_remind_targets(p_caller uuid)
returns table (user_id uuid, streak int, name text)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := public.olnu_helg_now();
  v_loc timestamp := v_now at time zone 'Europe/Stockholm';
  v_week date := public.olnu_helg_week(v_now);
  v_key timestamptz := (v_week::timestamp) at time zone 'Europe/Stockholm';
  r record;
  v_c jsonb;
  v_ok int;
begin
  if extract(isodow from v_loc) <> 5 or extract(hour from v_loc) < 17 then return; end if;
  for r in select distinct m2.user_id as uid
             from public.group_members m1 join public.group_members m2 on m2.group_id = m1.group_id
            where m1.user_id = p_caller and m2.user_id <> p_caller loop
    if exists (select 1 from public.push_sent ps where ps.user_id = r.uid and ps.kind = 'helg' and ps.night = v_key) then
      continue;
    end if;
    v_c := public.olnu_helg_calc(r.uid, v_now);
    if coalesce((v_c->>'at_risk')::boolean, false) and (v_c->>'streak')::int >= 1 then
      insert into public.push_sent (user_id, kind, night) values (r.uid, 'helg', v_key) on conflict do nothing;
      get diagnostics v_ok = row_count;
      if v_ok > 0 then
        user_id := r.uid; streak := (v_c->>'streak')::int;
        select gm.display_name into name from public.group_members gm where gm.user_id = r.uid order by gm.joined_at limit 1;
        return next;
      end if;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_helpers text := 'public.olnu_helg_now(), public.olnu_helg_week(timestamptz), public.olnu_helg_weeks(uuid), '
    || 'public.olnu_helg_calc(uuid, timestamptz), public.olnu_helg_group(uuid, timestamptz), public.helg_remind_targets(uuid)';
  v_rpcs text := 'public.helg_state()';
begin
  execute 'revoke all on function ' || v_helpers || ' from public';
  execute 'revoke all on function ' || v_rpcs || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_helpers || ' from anon';
    execute 'revoke all on function ' || v_rpcs || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_helpers || ' from authenticated';
    execute 'grant execute on function ' || v_rpcs || ' to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ' || v_helpers || ', ' || v_rpcs || ' to service_role';
  end if;
end $$;
