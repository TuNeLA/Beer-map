-- 0390 🔔 NOTISER v2 (agent ntf, 2026-11-08). ADDITIVE ONLY. Safe to run again. Nothing here can send a push:
-- pushes are sent only by notify-group (v28 + ntf v2 block, deployed AT RELEASE), and every new behaviour checks
-- push_v2_flags, which is created OFF. The release step turns the flags on (scratchpad/release-checklist.md).
--
-- New:
--   push_v2_flags        key → on (default false): ntf_v2 (priorities, variant rotation, fold, faces, auto-mute, feed),
--                        ikvall_proof (Fri/Sat "3 i gänget ska ut ikväll — du?"), gang_streak (Sunday "Gänget: 4 helger
--                        i rad"), winback (once after 21 silent days, only with real group news), send_time (per-user hour).
--   push_stats           per user + kind: sent, opened, acted, last open, open hours (24 buckets), last 8 variant ids,
--                        auto-muted time. Feeds the rotation, auto-mute and send-time rules. No text, no positions.
--   ntf_feed             in-app fallback: pushes the user did not get (no subscription, budget full, auto-muted). 48 h.
--   push_prefs.mode      'normal' | 'farre' ("Färre notiser": max 2 per night, only the high-priority kinds).
--   RPCs (authenticated) push_seen(p_items), my_ntf_feed(), ntf_feed_seen(), set_push_mode(p_mode)
--   RPCs (service_role)  push_v2_flags_get(), push_stats_get(p_uids), push_stats_sent(p_rows), push_pace_take2(…, p_prios),
--                        push_pace_due2(p_gap, p_limit, p_max), ikvall_proof_claim(p_limit, p_test),
--                        gang_streak_claim(p_limit, p_test), winback_claim(p_limit, p_test), ntf_feed_add(p_rows)
--   Changed (same output + new keys): olnu_push_cats() + 'ikvall', 'gang'; olnu_push_prefs_of() + mode, auto_muted, v2.
-- No row is ever removed by this file. The feed shows only the last 48 h (older rows stay, unused).

create table if not exists public.push_v2_flags (
  key        text primary key check (key in ('ntf_v2', 'ikvall_proof', 'gang_streak', 'winback', 'send_time')),
  on_        boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.push_v2_flags enable row level security;
revoke all on table public.push_v2_flags from public, anon, authenticated;
insert into public.push_v2_flags (key, on_) values
  ('ntf_v2', false), ('ikvall_proof', false), ('gang_streak', false), ('winback', false), ('send_time', false)
on conflict (key) do nothing;

create or replace function public.push_v2_on(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select f.on_ from public.push_v2_flags f where f.key = p_key), false)
$$;

create table if not exists public.push_stats (
  user_id    uuid not null,
  kind       text not null,
  sent       int not null default 0,
  opened     int not null default 0,
  acted      int not null default 0,
  last_sent  timestamptz,
  last_open  timestamptz,
  open_hours int[] not null default array_fill(0, array[24]),
  recent     text[] not null default '{}',     -- last 8 variant ids sent (newest last)
  muted_at   timestamptz,                       -- auto-mute (never opened); an open or a settings change clears it
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.push_stats enable row level security;
revoke all on table public.push_stats from public, anon, authenticated;

create table if not exists public.ntf_feed (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  kind       text not null,
  v          text,
  title      text not null,
  body       text,
  url        text,
  why        text,                              -- 'nosub' | 'cap' | 'muted' | 'quiet'
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists ntf_feed_user_idx on public.ntf_feed (user_id, created_at desc);
alter table public.ntf_feed enable row level security;
revoke all on table public.ntf_feed from public, anon, authenticated;

alter table public.push_prefs add column if not exists mode text not null default 'normal';

create or replace function public.olnu_push_cats()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['ute','chat','dm','plan','kaos','bar','kul','vanner','film','ikvall','gang']::text[]
$$;

create or replace function public.olnu_push_prefs_of(p_uid uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'v', 1,
    'off', coalesce(to_jsonb(p.off), '[]'::jsonb),
    'quiet_from', p.quiet_from,
    'quiet_to', p.quiet_to,
    'cap', coalesce(p.cap, 0),
    'cap_default', 15,
    'cats', to_jsonb(public.olnu_push_cats()),
    'tonight', greatest(
      coalesce((select r.n from public.push_rx r where r.user_id = p_uid and r.night = public.olnu_night_of(now())), 0),
      coalesce((select pp.n from public.push_pace pp where pp.user_id = p_uid and pp.night = public.olnu_night_of(now())), 0)),
    'mode', coalesce(p.mode, 'normal'),
    'auto_muted', coalesce((select jsonb_agg(s.kind order by s.kind) from public.push_stats s
                              where s.user_id = p_uid and s.muted_at is not null), '[]'::jsonb),
    'v2', public.push_v2_on('ntf_v2')
  )
  from (select 1) one left join public.push_prefs p on p.user_id = p_uid
$$;

-- "Färre notiser" switch. Any settings change also clears the auto-mute marks (the user decides now).
create or replace function public.set_push_mode(p_mode text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_m text := lower(coalesce(p_mode, 'normal'));
begin
  if v_m not in ('normal', 'farre') then raise exception 'invalid_pref'; end if;
  insert into public.push_prefs (user_id, mode, updated_at) values (v_uid, v_m, now())
  on conflict (user_id) do update set mode = excluded.mode, updated_at = now();
  update public.push_stats s set muted_at = null, updated_at = now() where s.user_id = v_uid and s.muted_at is not null;
  return public.olnu_push_prefs_of(v_uid);
end $$;

-- The service worker logs shown / open / action per push (kind k, variant v, Stockholm hour h). The page sends them in
-- batches of max 20. Only open + action are stored here (sent is counted by the server). An open un-mutes the kind.
create or replace function public.push_seen(p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); x jsonb; v_k text; v_e text; v_h int; v_n int := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_items'; end if;
  for x in select * from jsonb_array_elements(p_items) limit 20 loop
    v_e := x->>'e'; v_k := left(coalesce(x->>'k', ''), 16);
    if v_e not in ('open', 'action') or v_k !~ '^[a-z_]{2,16}$' then continue; end if;
    v_h := greatest(0, least(23, coalesce((x->>'h')::int, extract(hour from now() at time zone 'Europe/Stockholm')::int)));
    insert into public.push_stats (user_id, kind) values (v_uid, v_k) on conflict (user_id, kind) do nothing;
    update public.push_stats s set opened = s.opened + 1, acted = s.acted + (v_e = 'action')::int, last_open = now(),
      open_hours[v_h + 1] = s.open_hours[v_h + 1] + 1, muted_at = null, updated_at = now()
      where s.user_id = v_uid and s.kind = v_k;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

-- In-app fallback list (last 48 h, max 10, newest first) + mark seen.
create or replace function public.my_ntf_feed()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid();
begin
  return jsonb_build_object('v', 1, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'title', f.title,
      'body', f.body, 'url', f.url, 'why', f.why, 'at', f.created_at, 'seen', f.seen_at is not null) order by f.created_at desc)
    from (select * from public.ntf_feed x where x.user_id = v_uid and x.created_at > now() - interval '48 hours'
          order by x.created_at desc limit 10) f), '[]'::jsonb));
end $$;

create or replace function public.ntf_feed_seen()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_n int;
begin
  update public.ntf_feed f set seen_at = now() where f.user_id = v_uid and f.seen_at is null and f.created_at > now() - interval '48 hours';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

-- ---------- service role (notify-group) ----------
create or replace function public.push_v2_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(f.key, f.on_), '{}'::jsonb) from public.push_v2_flags f
$$;

create or replace function public.push_stats_get(p_uids uuid[])
returns table (uid uuid, kind text, sent int, opened int, recent text[], muted boolean, best_hour int)
language sql stable security definer set search_path to 'public' as $$
  select s.user_id, s.kind, s.sent, s.opened, s.recent, s.muted_at is not null,
    (select h - 1 from generate_subscripts(s.open_hours, 1) h where s.open_hours[h] > 0
      order by s.open_hours[h] desc, h limit 1)
  from public.push_stats s where s.user_id = any (p_uids[1:2000])
$$;

-- p_rows: [{u: uuid, k: kind, v: variant}] — one per recipient (not per device). Auto-mute: a low-priority kind
-- (kaos, bar, kul, gang) sent 10+ times in total and never opened in 30 days gets muted_at (pushes go to the feed).
create or replace function public.push_stats_sent(p_rows jsonb)
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare x jsonb; v_u uuid; v_k text; v_v text; v_n int := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return 0; end if;
  for x in select * from jsonb_array_elements(p_rows) limit 2000 loop
    begin v_u := (x->>'u')::uuid; exception when others then continue; end;
    v_k := left(coalesce(x->>'k', ''), 16); v_v := left(coalesce(x->>'v', ''), 24);
    if v_u is null or v_k !~ '^[a-z_]{2,16}$' then continue; end if;
    insert into public.push_stats (user_id, kind) values (v_u, v_k) on conflict (user_id, kind) do nothing;
    update public.push_stats s set sent = s.sent + 1, last_sent = now(),
      recent = case when v_v = '' then s.recent else (s.recent || v_v)[greatest(1, cardinality(s.recent || v_v) - 7):] end,
      muted_at = case when s.muted_at is null and v_k in ('kaos', 'bar', 'kul', 'gang') and s.sent + 1 >= 10
                       and (s.last_open is null or s.last_open < now() - interval '30 days') then now() else s.muted_at end,
      updated_at = now()
      where s.user_id = v_u and s.kind = v_k;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Same as push_pace_take (0260) plus priorities: the LAST slot of the night (n = max - 1) is kept for pushes with
-- priority >= p_reserve (friends out, Ikväll?, events, film); lower ones get 'cap' there (they go to the feed).
-- Mode 'farre' (push_prefs.mode): max 2 per night and only priority >= p_reserve.
create or replace function public.push_pace_take2(p_uids uuid[], p_lines text[], p_grps text[], p_gaps int[], p_maxes int[],
  p_prios int[], p_reserve int default 60)
returns table (uid uuid, verdict text, held_n int, held_lines text[], held_grp text)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_night timestamptz := public.olnu_night_of(now());
  i int; r public.push_pace%rowtype; v_u uuid; v_gap int; v_max int; v_line text; v_l text[]; v_p int; v_farre boolean;
begin
  for i in 1 .. least(coalesce(array_length(p_uids, 1), 0), 2000) loop
    v_u := p_uids[i];
    if v_u is null then continue; end if;
    v_gap := greatest(0, least(3600, coalesce(p_gaps[i], 600)));
    v_max := greatest(1, least(99, coalesce(p_maxes[i], 4)));
    v_p := coalesce(p_prios[i], 50);
    v_farre := coalesce((select pp.mode = 'farre' from public.push_prefs pp where pp.user_id = v_u), false);
    if v_farre then v_max := least(v_max, 2); end if;
    v_line := left(coalesce(p_lines[i], ''), 90);
    insert into public.push_pace (user_id, night) values (v_u, v_night) on conflict (user_id) do nothing;
    select * into r from public.push_pace where user_id = v_u for update;
    if r.night is distinct from v_night then
      r.night := v_night; r.n := 0; r.last_at := null; r.held := 0; r.lines := '{}'; r.grp := null; r.over_cap := 0;
    end if;
    if r.n >= v_max or (v_p < p_reserve and (v_farre or r.n >= v_max - 1)) then
      update public.push_pace set night = r.night, n = r.n, last_at = r.last_at, held = r.held, lines = r.lines, grp = r.grp,
        over_cap = r.over_cap + 1, updated_at = now() where user_id = v_u;
      uid := v_u; verdict := 'cap'; held_n := 0; held_lines := '{}'; held_grp := null; return next;
    elsif r.last_at is not null and r.last_at > now() - make_interval(secs => v_gap) then
      v_l := r.lines || v_line;
      if cardinality(v_l) > 4 then v_l := v_l[cardinality(v_l) - 3 : cardinality(v_l)]; end if;
      update public.push_pace set night = r.night, n = r.n, last_at = r.last_at, held = r.held + 1, lines = v_l,
        grp = coalesce(nullif(left(coalesce(p_grps[i], ''), 60), ''), r.grp), over_cap = r.over_cap, updated_at = now()
        where user_id = v_u;
      uid := v_u; verdict := 'hold'; held_n := r.held + 1; held_lines := v_l; held_grp := null; return next;
    else
      uid := v_u; verdict := case when r.held > 0 then 'digest' else 'send' end;
      held_n := r.held; held_lines := r.lines; held_grp := r.grp;
      update public.push_pace set night = r.night, n = r.n + 1, last_at = now(), held = 0, lines = '{}', grp = null,
        over_cap = r.over_cap, updated_at = now() where user_id = v_u;
      return next;
    end if;
  end loop;
end $$;

-- Same as push_pace_due (0260) but a digest never goes past the night budget (p_max, 2 in mode 'farre').
create or replace function public.push_pace_due2(p_gap int default 600, p_limit int default 25, p_max int default 4)
returns table (uid uuid, verdict text, held_n int, held_lines text[], held_grp text)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with due as (
    select p.user_id from public.push_pace p
    left join public.push_prefs pp on pp.user_id = p.user_id
    where p.night = v_night and p.held > 0 and cardinality(p.lines) > 0
      and p.last_at < now() - make_interval(secs => greatest(60, least(3600, coalesce(p_gap, 600))))
      and p.n < case when pp.mode = 'farre' then least(2, coalesce(p_max, 4))
                     when pp.cap in (5, 10, 20, 99) then pp.cap else coalesce(p_max, 4) end
    order by p.last_at
    limit greatest(1, least(100, coalesce(p_limit, 25)))
    for update of p skip locked
  ), old as (
    select p.user_id, p.held, p.lines, p.grp from public.push_pace p join due d on d.user_id = p.user_id
  ), upd as (
    update public.push_pace p set n = p.n + 1, last_at = now(), held = 0, lines = '{}', grp = null, updated_at = now()
    from due d where p.user_id = d.user_id
    returning p.user_id
  )
  select o.user_id, 'digest'::text, o.held, o.lines, o.grp from old o join upd u on u.user_id = o.user_id;
end $$;

-- p_rows: [{u, k, v, t (title), b (body), url, why}]
create or replace function public.ntf_feed_add(p_rows jsonb)
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare x jsonb; v_u uuid; v_n int := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return 0; end if;
  for x in select * from jsonb_array_elements(p_rows) limit 2000 loop
    begin v_u := (x->>'u')::uuid; exception when others then continue; end;
    if v_u is null or coalesce(x->>'t', '') = '' then continue; end if;
    -- one row per user + url per 6 h (a repeated digest does not fill the list)
    if exists (select 1 from public.ntf_feed f where f.user_id = v_u and f.url is not distinct from left(x->>'url', 200)
               and f.title = left(x->>'t', 80) and f.created_at > now() - interval '6 hours') then continue; end if;
    insert into public.ntf_feed (user_id, kind, v, title, body, url, why)
    values (v_u, left(coalesce(x->>'k', 'other'), 16), left(x->>'v', 24), left(x->>'t', 80), left(x->>'b', 160),
            left(x->>'url', 200), left(x->>'why', 12));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 🍺 Ikväll? with social proof. Fri/Sat 17:30–20:59 Stockholm; flag ikvall_proof. A user is claimed when:
-- has no answer tonight, kind 'ikvall' not off, not sent this week (max 1 per week), and >= 2 people from their groups
-- answered 'ute' tonight. send_time flag: the user's start hour = their most-opened hour in 17..20 (>= 3 opens), else 17:30.
-- Returns the first two names (as shown in the shared group) + the count. p_test = only test-zone users and no time
-- window (live tests; service role only). The same p_test rule is in gang_streak_claim and winback_claim.
create or replace function public.ikvall_proof_claim(p_limit int default 500, p_test boolean default false)
returns table (uid uuid, names text[], n_ute int, has_sub boolean)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_l timestamp := now() at time zone 'Europe/Stockholm';
  v_night timestamptz := public.olnu_night_of(now());
  v_week text := to_char(v_l, 'IYYY-IW');
  v_st boolean := public.push_v2_on('send_time');
begin
  if not public.push_v2_on('ikvall_proof') then return; end if;
  if not coalesce(p_test, false) and (extract(isodow from v_l) not in (5, 6) or v_l::time < time '17:30' or v_l::time >= time '21:00') then return; end if;
  return query
  with mates as (
    select me.user_id as u, gm.user_id as m, min(gm.display_name) as nm
      from public.group_members me join public.group_members gm on gm.group_id = me.group_id and gm.user_id <> me.user_id
      join public.ikvall_status s on s.user_id = gm.user_id and s.night = v_night and s.st = 'ute'
     group by me.user_id, gm.user_id
  ), c as (
    select x.u, (array_agg(x.nm order by x.nm))[1:2] as nms, count(*)::int as n
      from mates x
     where not exists (select 1 from public.ikvall_status s2 where s2.user_id = x.u and s2.night = v_night)
       and not exists (select 1 from public.push_prefs pp where pp.user_id = x.u and 'ikvall' = any (pp.off))
       and not exists (select 1 from public.push_sent ps where ps.user_id = x.u and ps.kind = 'ikv2:' || v_week)
       and (public.olnu_is_test_user(x.u) = coalesce(p_test, false))
       and (not v_st or extract(hour from v_l)::int >= coalesce((
             select h - 1 from public.push_stats st, generate_subscripts(st.open_hours, 1) h
              where st.user_id = x.u and st.kind in ('ikvall', 'ute') and h - 1 between 17 and 20 and st.open_hours[h] > 0
              group by h having sum(st.open_hours[h]) >= 3 order by sum(st.open_hours[h]) desc, h limit 1), 17))
     group by x.u
    having count(*) >= 2
     order by x.u
     limit greatest(1, least(2000, coalesce(p_limit, 500)))
  ), ins as (
    insert into public.push_sent (user_id, kind, night, sent_at)
    select c.u, 'ikv2:' || v_week, v_night, now() from c
    on conflict do nothing
    returning user_id
  )
  select c.u, c.nms, c.n, exists (select 1 from public.push_subscriptions ps where ps.user_id = c.u)
    from c join ins on ins.user_id = c.u;
end $$;

-- 🔥 Gänget: N helger i rad (>= 3 members out the same weekend, olnu_helg_group). Sunday 12:00–19:59; flag gang_streak.
-- Celebration only (never "your streak is at risk"). Once per group per week, at streak 3, 4, 5, 6, 8, 10, 12, 15, 20, 26, 52.
create or replace function public.gang_streak_claim(p_limit int default 200, p_test boolean default false)
returns table (uid uuid, group_id uuid, group_name text, streak int, has_sub boolean)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_l timestamp := now() at time zone 'Europe/Stockholm';
  v_week text := to_char(v_l, 'IYYY-IW');
  v_night timestamptz := public.olnu_night_of(now());
begin
  if not public.push_v2_on('gang_streak') then return; end if;
  if not coalesce(p_test, false) and (extract(isodow from v_l) <> 7 or extract(hour from v_l) < 12 or extract(hour from v_l) >= 20) then return; end if;
  return query
  with g as (
    select x.id, x.name, (public.olnu_helg_group(x.id, now())->>'streak')::int as s
      from public.groups x
     where exists (select 1 from public.group_members gm where gm.group_id = x.id
                   having count(*) >= 3 and bool_and(public.olnu_is_test_user(gm.user_id)) = coalesce(p_test, false))
     limit 5000
  ), ok as (
    select g.* from g where g.s in (3, 4, 5, 6, 8, 10, 12, 15, 20, 26, 52)
      and not exists (select 1 from public.push_sent ps where ps.night > now() - interval '8 days' and ps.kind = 'gang:' || g.id || ':' || v_week)
     limit greatest(1, least(500, coalesce(p_limit, 200)))
  ), mark as (
    insert into public.push_sent (user_id, kind, night, sent_at)
    select gm.user_id, 'gang:' || ok.id || ':' || v_week, v_night, now()
      from ok join public.group_members gm on gm.group_id = ok.id
    on conflict do nothing
    returning user_id, kind
  )
  select m.user_id, ok.id, ok.name, ok.s, exists (select 1 from public.push_subscriptions ps where ps.user_id = m.user_id)
    from mark m join ok on m.kind = 'gang:' || ok.id || ':' || v_week
   where not exists (select 1 from public.push_prefs pp where pp.user_id = m.user_id and 'gang' = any (pp.off));
end $$;

-- 👋 Win-back: once per 120 days, only with real group news. A user is "silent" when nothing of theirs (beer, check-in,
-- Ikväll? answer, chat line, push open) is newer than 21 days, and at least 2 people of their groups were active in
-- the last 14 days. Sunday 13:00–17:59 Stockholm only; flag winback. Kind 'gang' (off = never).
create or replace function public.winback_claim(p_limit int default 200, p_test boolean default false)
returns table (uid uuid, group_name text, names text[], n_active int)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_l timestamp := now() at time zone 'Europe/Stockholm';
  v_night timestamptz := public.olnu_night_of(now());
begin
  if not public.push_v2_on('winback') then return; end if;
  if not coalesce(p_test, false) and (extract(isodow from v_l) <> 7 or extract(hour from v_l) < 13 or extract(hour from v_l) >= 18) then return; end if;
  return query
  with subs as (
    select distinct ps.user_id as u from public.push_subscriptions ps
     where public.olnu_is_test_user(ps.user_id) = coalesce(p_test, false)
  ), silent as (
    select s.u from subs s
     where not exists (select 1 from public.beers b where b.user_id = s.u and b.created_at > now() - interval '21 days')
       and not exists (select 1 from public.checkins c where c.user_id = s.u and c.created_at > now() - interval '21 days')
       and not exists (select 1 from public.ikvall_status i where i.user_id = s.u and i.updated_at > now() - interval '21 days')
       and not exists (select 1 from public.push_stats st where st.user_id = s.u and st.last_open > now() - interval '21 days')
       and not exists (select 1 from public.push_sent pz where pz.user_id = s.u and pz.kind = 'winback' and pz.sent_at > now() - interval '120 days')
       and not exists (select 1 from public.push_prefs pp where pp.user_id = s.u and 'gang' = any (pp.off))
  ), news as (
    select s.u, g.name as gname, (array_agg(distinct gm.display_name))[1:2] as nms, count(distinct gm.user_id)::int as n
      from silent s
      join public.group_members me on me.user_id = s.u
      join public.groups g on g.id = me.group_id
      join public.group_members gm on gm.group_id = me.group_id and gm.user_id <> s.u
     where exists (select 1 from public.beers b where b.user_id = gm.user_id and b.created_at > now() - interval '14 days')
        or exists (select 1 from public.checkins c where c.user_id = gm.user_id and c.created_at > now() - interval '14 days')
     group by s.u, g.name
    having count(distinct gm.user_id) >= 2
  ), pick as (
    select distinct on (n.u) n.* from news n order by n.u, n.n desc, n.gname
     limit greatest(1, least(1000, coalesce(p_limit, 200)))
  ), ins as (
    insert into public.push_sent (user_id, kind, night, sent_at)
    select p.u, 'winback', v_night, now() from pick p
    on conflict do nothing
    returning user_id
  )
  select p.u, p.gname, p.nms, p.n from pick p join ins on ins.user_id = p.u;
end $$;

revoke all on function public.push_v2_on(text) from public, anon, authenticated;
revoke all on function public.set_push_mode(text) from public, anon;
revoke all on function public.push_seen(jsonb) from public, anon;
revoke all on function public.my_ntf_feed() from public, anon;
revoke all on function public.ntf_feed_seen() from public, anon;
revoke all on function public.push_v2_flags_get() from public, anon, authenticated;
revoke all on function public.push_stats_get(uuid[]) from public, anon, authenticated;
revoke all on function public.push_stats_sent(jsonb) from public, anon, authenticated;
revoke all on function public.push_pace_take2(uuid[], text[], text[], int[], int[], int[], int) from public, anon, authenticated;
revoke all on function public.push_pace_due2(int, int, int) from public, anon, authenticated;
revoke all on function public.ntf_feed_add(jsonb) from public, anon, authenticated;
revoke all on function public.ikvall_proof_claim(int, boolean) from public, anon, authenticated;
revoke all on function public.gang_streak_claim(int, boolean) from public, anon, authenticated;
revoke all on function public.winback_claim(int, boolean) from public, anon, authenticated;
grant execute on function public.set_push_mode(text) to authenticated;
grant execute on function public.push_seen(jsonb) to authenticated;
grant execute on function public.my_ntf_feed() to authenticated;
grant execute on function public.ntf_feed_seen() to authenticated;
grant execute on function public.push_v2_on(text) to service_role;
grant execute on function public.push_v2_flags_get() to service_role;
grant execute on function public.push_stats_get(uuid[]) to service_role;
grant execute on function public.push_stats_sent(jsonb) to service_role;
grant execute on function public.push_pace_take2(uuid[], text[], text[], int[], int[], int[], int) to service_role;
grant execute on function public.push_pace_due2(int, int, int) to service_role;
grant execute on function public.ntf_feed_add(jsonb) to service_role;
grant execute on function public.ikvall_proof_claim(int, boolean) to service_role;
grant execute on function public.gang_streak_claim(int, boolean) to service_role;
grant execute on function public.winback_claim(int, boolean) to service_role;
