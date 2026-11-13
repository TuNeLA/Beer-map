-- 0510 · security audit fixes (lane secaudit, 13 Nov 2026). OWNER-RUN. Staging first. Report: scratchpad/secaudit/REPORT.md.
-- A3-EXCEPTION: security hotfix; the same anchor patch must land on today's live functions AND on the release-model functions when the big list runs later (a full CREATE OR REPLACE from one snapshot would undo the other model). Coordinator dry-runs it on live in a rolled-back transaction before the real apply.
-- Check after the run (expect t, t, t, t, t, t, t, t, t):
--   select position('/*s510*/' in pg_get_functiondef('public.olnu_find_resolve(text, uuid)'::regprocedure)) > 0,
--     position('/*s510*/' in pg_get_functiondef('public.olnu_find_allowed(uuid, uuid)'::regprocedure)) > 0,
--     position('/*s510*/' in pg_get_functiondef('public.walk_poll()'::regprocedure)) > 0,
--     position('/*s510*/' in pg_get_functiondef('public.olnu_inv_resolve(uuid, text[], uuid[])'::regprocedure)) > 0,
--     position('/*s510*/' in pg_get_functiondef('public.my_invites()'::regprocedure)) > 0,
--     position('/*s510*/' in pg_get_functiondef('public.olnu_crew_group_json(uuid, uuid, boolean)'::regprocedure)) > 0,
--     position('/*s510*/' in pg_get_functiondef('public.join_group(text, text)'::regprocedure)) > 0,
--     position('/*s510*/' in pg_get_functiondef('public.join_preview(text)'::regprocedure)) > 0,
--     exists (select 1 from pg_trigger where tgname = 'olnu_s510_age_beers');
--
-- Needs: olnu_sec_patch (0430), olnu_ub_hidden (0400), olnu_gw_client_key (gw), olnu_strip_cr (0436). All are on live today.
-- Works on the live DB of 13 Nov (before the big list) and after the big list (the target functions are the same text).
--
-- A. A BLOCK REALLY HIDES (today, live): V blocks K, both in one group. Tested local copy of live, scratchpad/secaudit/t:
--   1. Hitta (find_request + find_ping): K could still ask to find V and got V's EXACT live position (V shares with groups).
--      Fix: olnu_find_resolve says invalid_target for a blocked pair; olnu_find_allowed is false for a blocked pair.
--   2. Följ mig hem (walk_poll): K got V's live position and home area for a walk V started AFTER the block.
--      Fix: walk_poll skips walks of a blocked pair (also for a block made during the walk).
--   3. olnu_inv_resolve (recipients of walk_start, pickup_start, invite_create, invite_add): a whole group was resolved,
--      blocked people too. Fix: blocked people are left out.
--   4. my_invites: an invite from a blocked person still showed (place, time, note). Fix: skip it.
--   5. Gänget departures (olnu_crew_group_json deps): K saw V's "leaving for bar X at 22:30" with the bar position.
--      Fix: skip departures of a blocked pair.
-- B. Group code guessing (after): join_group / join_preview counted fails per user only, and anonymous users are free.
--    Fix: also max 60 failed codes per IP per 10 minutes (same IP key as link_preview, row key 'j510:<ip md5>').
-- C. Age gate (after): the server never used age_ok. Fix: a person who said "under 18" (age_ok = false) cannot post a beer,
--    join a group, write in a chat, start a walk or ask for a pickup. People with age_ok null or true: no change.
-- With no block and no under-18 answer every answer is the same as before.
-- Additive: exact text patches (marker /*s510*/, skipped when present), create or replace function, create or replace
-- trigger, grants and revokes on the new helpers. No row or object is removed. Safe to run twice. CR LF safe.

-- A1. Hitta: resolve a find key → invalid_target when one of the two blocked the other
select public.olnu_sec_patch('public.olnu_find_resolve(text, uuid)', '/*s510*/',
  array[$a$uid := public.olnu_friend_other(f, p_uid);$a$,
        $a$if uid is null or uid = p_uid then raise exception 'invalid_target'; end if;$a$],
  array[$a$uid := public.olnu_friend_other(f, p_uid);
    if public.olnu_ub_hidden(p_uid, uid) then raise exception 'invalid_target'; end if; /*s510*/$a$,
        $a$if uid is null or uid = p_uid or public.olnu_ub_hidden(p_uid, uid) then raise exception 'invalid_target'; end if;$a$]);

-- A1b. Hitta: never "allowed" between a blocked pair (old accepted requests, group share, an old find_pos row)
select public.olnu_sec_patch('public.olnu_find_allowed(uuid, uuid)', '/*s510*/',
  array[$a$select exists (select 1 from public.find_reqs r$a$,
        $a$fp.expires_at > now() and fp.lat is not null);$a$],
  array[$a$select not public.olnu_ub_hidden(p_viewer, p_target) /*s510*/ and (exists (select 1 from public.find_reqs r$a$,
        $a$fp.expires_at > now() and fp.lat is not null));$a$]);

-- A2. Följ mig hem: the watch list and the "seen" mark skip a blocked pair
select public.olnu_sec_patch('public.walk_poll()', '/*s510*/',
  array[$a$where v_uid = any (x.viewers) and x.ended_at is null and x.ends_at > now()$a$,
        $a$where v_uid = any (x.viewers) and x.user_id <> v_uid$a$],
  array[$a$where v_uid = any (x.viewers) and x.ended_at is null and x.ends_at > now() and not public.olnu_ub_hidden(v_uid, x.user_id)$a$,
        $a$where v_uid = any (x.viewers) and x.user_id <> v_uid and not public.olnu_ub_hidden(v_uid, x.user_id) /*s510*/$a$]);

-- A3. Recipients of a walk / pickup / invite: never a blocked person
select public.olnu_sec_patch('public.olnu_inv_resolve(uuid, text[], uuid[])', '/*s510*/',
  array[$a$select coalesce(array_agg(distinct x.uid), '{}'::uuid[]) into v from ($a$],
  array[$a$select coalesce(array_agg(distinct x.uid) filter (where not public.olnu_ub_hidden(p_uid, x.uid)), '{}'::uuid[]) /*s510*/ into v from ($a$]);

-- A4. Mina inbjudningar: no invite from a blocked person
select public.olnu_sec_patch('public.my_invites()', '/*s510*/',
  array[$a$where i.ends_at > now() and (i.status = 'open' or i.updated_at > now() - interval '12 hours')$a$],
  array[$a$where i.ends_at > now() and (i.status = 'open' or i.updated_at > now() - interval '12 hours')
               and not public.olnu_ub_hidden(v_uid, i.creator) /*s510*/$a$]);

-- A5. Gänget: departures ("drar till X kl 22:30") of a blocked pair are not shown
select public.olnu_sec_patch('public.olnu_crew_group_json(uuid, uuid, boolean)', '/*s510*/',
  array[$a$where d.group_id = p_group and d.night = v_night and d.cancelled_at is null$a$],
  array[$a$where d.group_id = p_group and d.night = v_night and d.cancelled_at is null and not public.olnu_ub_hidden(p_uid, d.user_id) /*s510*/$a$]);

-- B. Group codes: a fail counter per IP (10-minute slots in gw_link_hits, the table link_preview uses)
create or replace function public.olnu_s510_join_limited()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_k text := public.olnu_gw_client_key();
  v_bad int;
begin
  if v_k is null or v_k = 'none' then return false; end if;
  select h.bad into v_bad from public.gw_link_hits h
   where h.k = 'j510:' || v_k and h.slot = floor(extract(epoch from now()) / 600)::bigint;
  return coalesce(v_bad, 0) >= 60;
end $$;

create or replace function public.olnu_s510_join_fail()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_k text := public.olnu_gw_client_key();
begin
  if v_k is null or v_k = 'none' then return; end if;
  insert into public.gw_link_hits as h (k, slot, n, bad)
  values ('j510:' || v_k, floor(extract(epoch from now()) / 600)::bigint, 1, 1)
  on conflict (k, slot) do update set n = h.n + 1, bad = h.bad + 1;
end $$;

revoke all on function public.olnu_s510_join_limited() from public, anon, authenticated;
revoke all on function public.olnu_s510_join_fail() from public, anon, authenticated;

select public.olnu_sec_patch('public.join_group(text, text)', '/*s510*/',
  array[$a$if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then$a$,
        $a$insert into public.join_fails (user_id) values (v_uid);$a$],
  array[$a$if public.olnu_s510_join_limited() /*s510*/ or (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then$a$,
        $a$insert into public.join_fails (user_id) values (v_uid);
    perform public.olnu_s510_join_fail();$a$]);

select public.olnu_sec_patch('public.join_preview(text)', '/*s510*/',
  array[$a$if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then$a$,
        $a$insert into public.join_fails (user_id) values (v_uid);$a$],
  array[$a$if public.olnu_s510_join_limited() /*s510*/ or (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then$a$,
        $a$insert into public.join_fails (user_id) values (v_uid);
    perform public.olnu_s510_join_fail();$a$]);

-- C. Age gate on the server: "under 18" (age_ok = false) stops the main writes of that same person
create or replace function public.olnu_s510_age_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null and new.user_id = v_uid
     and exists (select 1 from public.user_safety s where s.user_id = v_uid and s.age_ok is false) then
    raise exception 'age_blocked';
  end if;
  return new;
end $$;

revoke all on function public.olnu_s510_age_tg() from public, anon, authenticated;

create or replace trigger olnu_s510_age_beers before insert on public.beers
  for each row execute function public.olnu_s510_age_tg();
create or replace trigger olnu_s510_age_members before insert on public.group_members
  for each row execute function public.olnu_s510_age_tg();
create or replace trigger olnu_s510_age_msgs before insert on public.group_msgs
  for each row execute function public.olnu_s510_age_tg();
create or replace trigger olnu_s510_age_walks before insert on public.walks
  for each row execute function public.olnu_s510_age_tg();
create or replace trigger olnu_s510_age_pickups before insert on public.pickup_reqs
  for each row execute function public.olnu_s510_age_tg();

select public.olnu_strip_cr();
