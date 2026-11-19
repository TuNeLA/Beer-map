-- 0531 · opening hours: "Stämmer öppettiderna?" (yes / no / fix), a few votes change what we show, the owner sees the fixes,
-- and closed-place signals (lane places, E4, data-sources.md items 2, 3). OWNER-RUN. Staging first.
-- Check after the run (expect t, t, t, t, f, t, f):
--   select to_regclass('public.bar_hours_reports') is not null, to_regclass('public.bar_hours_fixed') is not null,
--     to_regprocedure('public.vote_bar_hours(text, text, text[])') is not null,
--     has_function_privilege('authenticated', 'public.bar_hours_state(text)', 'execute'),
--     has_function_privilege('anon', 'public.bar_hours_state(text)', 'execute'),
--     to_regprocedure('public.owner_place_signals(text, integer)') is not null,
--     has_function_privilege('anon', 'public.olnu_hours_week_ok(text[])', 'execute');
--
-- Why: 45 % of the bars have OpenStreetMap hours, 10 % of those have a check date, Ludvika has none. The guests in the bar
-- are the best source. The audit (data-sources.md, Top 10 no. 2 and 3) asks for a confirm / fix loop and closed-place signals.
-- What is new (nothing existing changes; the client hides each part when its function is missing = PGRST202):
--   table bar_hours_reports: one row per vote (bar, user, kind yes | no | fix | here, the week for a fix). Rows stay (history).
--     The NEWEST vote of each user per bar in the last 180 days counts. Nobody sees who voted: only counts and dates.
--   table bar_hours_fixed: the hours we show instead of OpenStreetMap for one bar (src crowd | owner), or cleared.
--   vote_bar_hours(bar, kind, week)  a signed-in user votes. kind: yes (the shown hours are right), no (they are wrong),
--     fix (with the right week), here (the place still exists: answer to "Finns stället kvar?"; not an hours vote).
--     Limits: 30 votes a day, one hours vote (and one "here") per bar in 10 minutes. A fix goes live for everybody when 2 different users sent the SAME week in 180 days
--     (src crowd), unless the owner set the hours in the last 12 months. Returns bar_hours_state.
--   bar_hours_state(bar)  counts {yes, no, fix, here}, last_yes, mine (my newest kind), fixed {w, src, at}, need (2), and
--     check = true when the place has a closed-place signal (see owner_place_signals) and nobody said "here" in 30 days.
--   bar_hours_fixes()  every live fix [{id, w, src, at}] (the app reads it once and shows these hours everywhere).
--   owner_hours_reports(key, days)  the owner page: per bar the counts, the most sent fix week + how many sent it, and the
--     live fix. owner_set_bar_hours(key, bar, week, clear)  the owner sets (or clears) the hours of a bar (src owner).
--   owner_place_signals(key, weeks)  closed-place signals per active bar: (a) no check-in for N weeks (default 8) when the
--     bar had check-ins before, (b) an open "Finns inte längre" report (bar_gone_reports), (c) 2 or more "no" votes on the
--     hours. 2 signals = likely closed (the owner decides with owner_set_bar_gone, which exists). Nothing is hidden here.
-- Security: every security definer function has a fixed search_path. User functions start with olnu_uid() (auth.uid(),
--   raises not_authenticated). Owner functions check the owner key (olnu_wd_owner_ok, as owner_set_bar_gone). Execute is
--   revoked from public and anon on the user functions; the owner functions are anon + authenticated on purpose (the owner
--   page signs in with the key only, like the other owner_* functions). The tables have RLS on, no policy and no grant.
-- GDPR: user_id is in bar_hours_reports only. delete_my_data re-keys every public table with a uuid column (as 0521 says).
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_uid, olnu_area_bar_pos, olnu_wd_owner_ok, olnu_strip_cr (0436).

create table if not exists public.bar_hours_reports (
  id         bigserial primary key,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  user_id    uuid not null,
  kind       text not null check (kind in ('yes', 'no', 'fix', 'here')),
  week       text[],
  bar_lat    double precision not null,
  bar_lng    double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists bar_hours_reports_bar_idx on public.bar_hours_reports (bar_id, created_at);
create index if not exists bar_hours_reports_user_idx on public.bar_hours_reports (user_id, created_at);
alter table public.bar_hours_reports enable row level security;
revoke all on table public.bar_hours_reports from public, anon, authenticated;

create table if not exists public.bar_hours_fixed (
  bar_id   text primary key check (char_length(bar_id) between 1 and 80),
  week     text[],
  src      text not null check (src in ('crowd', 'owner')),
  n        integer not null default 0,
  cleared  boolean not null default false,
  set_at   timestamptz not null default now()
);
alter table public.bar_hours_fixed enable row level security;
revoke all on table public.bar_hours_fixed from public, anon, authenticated;

-- the last check-in night per bar (closed-place signal a): medal_checkins has every check-in night
create index if not exists medal_checkins_bar_night_idx on public.medal_checkins (bar_id, night);

-- A week = 7 strings Mo..Su in the hours.json format: "" (closed) or up to 4 parts "start-end" in minutes after that day's
-- 00:00, start < end, start < 1440, end <= 2880 (after midnight). Example: {"", "", "", "960-1440", "960-1560", "720-1560", ""}.
create or replace function public.olnu_hours_week_ok(p_week text[])
returns boolean language plpgsql immutable set search_path = public as $$
declare d text; part text; m text[];
begin
  if p_week is null or array_length(p_week, 1) is distinct from 7 or array_ndims(p_week) <> 1 then return false; end if;
  foreach d in array p_week loop
    if d is null then return false; end if;
    if d = '' then continue; end if;
    if char_length(d) > 40 or d !~ '^[0-9]{1,4}-[0-9]{1,4}(,[0-9]{1,4}-[0-9]{1,4}){0,3}$' then return false; end if;
    foreach part in array string_to_array(d, ',') loop
      m := string_to_array(part, '-');
      if m[1]::int >= 1440 or m[2]::int > 2880 or m[1]::int >= m[2]::int then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
revoke all on function public.olnu_hours_week_ok(text[]) from public, anon, authenticated;

-- The newest hours vote (yes | no | fix) of each user for one bar in the last 180 days (internal). "here" is not an hours vote.
create or replace function public.olnu_hours_votes(p_bar_id text)
returns table (user_id uuid, kind text, week text[], created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (r.user_id) r.user_id, r.kind, r.week, r.created_at
    from public.bar_hours_reports r
   where r.bar_id = p_bar_id and r.kind <> 'here' and r.created_at > now() - interval '180 days'
   order by r.user_id, r.created_at desc, r.id desc;
$$;
revoke all on function public.olnu_hours_votes(text) from public, anon, authenticated;

-- Closed-place signals of one bar (internal): {nock: no check-in for p_weeks weeks (the bar had check-ins before),
-- gone: open "Finns inte längre" reports, no: users whose newest hours vote is "no", n: how many of the three are true}.
create or replace function public.olnu_place_signal(p_bar_id text, p_weeks integer default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_last timestamptz; v_gone int; v_no int; v_nock boolean;
begin
  select max(c.night) into v_last from public.medal_checkins c where c.bar_id = p_bar_id;
  v_nock := v_last is not null and v_last < now() - make_interval(weeks => greatest(1, least(coalesce(p_weeks, 8), 104)));
  select count(distinct g.user_id)::int into v_gone from public.bar_gone_reports g
   where g.bar_id = p_bar_id and g.withdrawn_at is null and g.created_at > now() - interval '180 days';
  select count(*)::int into v_no from public.olnu_hours_votes(p_bar_id) v where v.kind = 'no';
  return jsonb_build_object('nock', v_nock, 'last_checkin', v_last, 'gone', v_gone, 'no', v_no,
    'n', (case when v_nock then 1 else 0 end) + (case when v_gone > 0 then 1 else 0 end) + (case when v_no >= 2 then 1 else 0 end));
end $$;
revoke all on function public.olnu_place_signal(text, integer) from public, anon, authenticated;

create or replace function public.bar_hours_state(p_bar_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_c jsonb; v_mine text; v_last timestamptz; v_fix jsonb; v_sig jsonb; v_here timestamptz; v_nh int;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  select jsonb_build_object('yes', count(*) filter (where v.kind = 'yes'), 'no', count(*) filter (where v.kind = 'no'),
                            'fix', count(*) filter (where v.kind = 'fix')),
         max(v.created_at) filter (where v.kind = 'yes'), max(v.kind) filter (where v.user_id = v_uid)
    into v_c, v_last, v_mine
    from public.olnu_hours_votes(p_bar_id) v;
  -- "Finns stället kvar?": distinct users who said "here" in the last 30 days
  select max(r.created_at), count(distinct r.user_id)::int into v_here, v_nh from public.bar_hours_reports r
   where r.bar_id = p_bar_id and r.kind = 'here' and r.created_at > now() - interval '30 days';
  v_c := v_c || jsonb_build_object('here', v_nh);
  select jsonb_build_object('w', f.week, 'src', f.src, 'at', f.set_at, 'n', f.n) into v_fix
    from public.bar_hours_fixed f where f.bar_id = p_bar_id and not f.cleared and f.week is not null;
  v_sig := public.olnu_place_signal(p_bar_id, 8);
  return jsonb_build_object('bar_id', p_bar_id, 'counts', v_c, 'last_yes', v_last, 'mine', v_mine, 'fixed', v_fix, 'need', 2,
    'check', (v_sig->>'n')::int >= 1 and v_here is null);
end $$;
revoke all on function public.bar_hours_state(text) from public, anon, authenticated;
grant execute on function public.bar_hours_state(text) to authenticated;

create or replace function public.vote_bar_hours(p_bar_id text, p_kind text, p_week text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_pos double precision[];
  v_same int; v_owner boolean;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  if v_kind not in ('yes', 'no', 'fix', 'here') then raise exception 'invalid_kind'; end if;
  if v_kind = 'fix' and not public.olnu_hours_week_ok(p_week) then raise exception 'invalid_hours'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-hours:' || v_uid::text, 0));
  if (select count(*) from public.bar_hours_reports r where r.user_id = v_uid and r.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from public.bar_hours_reports r where r.user_id = v_uid and r.bar_id = p_bar_id and (r.kind = 'here') = (v_kind = 'here')
               and r.created_at > now() - interval '10 minutes') then
    raise exception 'slow_down';
  end if;
  insert into public.bar_hours_reports (bar_id, user_id, kind, week, bar_lat, bar_lng)
  values (p_bar_id, v_uid, v_kind, case when v_kind = 'fix' then p_week end, v_pos[1], v_pos[2]);
  if v_kind = 'fix' then
    perform pg_advisory_xact_lock(hashtextextended('olnu-hours-bar:' || p_bar_id, 0));
    select count(*)::int into v_same from public.olnu_hours_votes(p_bar_id) v where v.kind = 'fix' and v.week = p_week;
    v_owner := exists (select 1 from public.bar_hours_fixed f where f.bar_id = p_bar_id and f.src = 'owner' and f.set_at > now() - interval '12 months');
    if v_same >= 2 and not v_owner then
      insert into public.bar_hours_fixed (bar_id, week, src, n, cleared, set_at) values (p_bar_id, p_week, 'crowd', v_same, false, now())
      on conflict (bar_id) do update set week = excluded.week, src = 'crowd', n = excluded.n, cleared = false, set_at = now();
    end if;
  end if;
  return public.bar_hours_state(p_bar_id);
end $$;
revoke all on function public.vote_bar_hours(text, text, text[]) from public, anon, authenticated;
grant execute on function public.vote_bar_hours(text, text, text[]) to authenticated;

create or replace function public.bar_hours_fixes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.bar_id, 'w', f.week, 'src', f.src, 'at', f.set_at) order by f.bar_id)
                     from public.bar_hours_fixed f where not f.cleared and f.week is not null and v_uid is not null), '[]'::jsonb);
end $$;
revoke all on function public.bar_hours_fixes() from public, anon, authenticated;
grant execute on function public.bar_hours_fixes() to authenticated;

create or replace function public.owner_hours_reports(p_key text, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.at desc) from (
      select b.bar_id, max(r.created_at) as at, jsonb_build_object(
        'bar_id', b.bar_id,
        'name', (select l.name from public.bars_lite l where l.id = b.bar_id),
        'lat', max(r.bar_lat), 'lng', max(r.bar_lng), 'last', max(r.created_at),
        'yes', (select count(*) from public.olnu_hours_votes(b.bar_id) v where v.kind = 'yes'),
        'no', (select count(*) from public.olnu_hours_votes(b.bar_id) v where v.kind = 'no'),
        'fix', (select count(*) from public.olnu_hours_votes(b.bar_id) v where v.kind = 'fix'),
        'top', (select jsonb_build_object('w', v.week, 'n', count(*)) from public.olnu_hours_votes(b.bar_id) v
                 where v.kind = 'fix' group by v.week order by count(*) desc, max(v.created_at) desc limit 1),
        'fixed', (select jsonb_build_object('w', f.week, 'src', f.src, 'at', f.set_at, 'cleared', f.cleared)
                    from public.bar_hours_fixed f where f.bar_id = b.bar_id)) as j
        from (select distinct r0.bar_id from public.bar_hours_reports r0 where r0.created_at > now() - make_interval(days => v_days)) b
        join public.bar_hours_reports r on r.bar_id = b.bar_id
       group by b.bar_id
       limit 500) x), '[]'::jsonb);
end $$;
revoke all on function public.owner_hours_reports(text, integer) from public, anon, authenticated;
grant execute on function public.owner_hours_reports(text, integer) to anon, authenticated;

create or replace function public.owner_set_bar_hours(p_key text, p_bar_id text, p_week text[], p_clear boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 or public.olnu_area_bar_pos(p_bar_id) is null then raise exception 'invalid_bar'; end if;
  if coalesce(p_clear, false) then
    update public.bar_hours_fixed f set cleared = true, src = 'owner', set_at = now() where f.bar_id = p_bar_id;
    return jsonb_build_object('ok', true, 'bar_id', p_bar_id, 'cleared', true);
  end if;
  if not public.olnu_hours_week_ok(p_week) then raise exception 'invalid_hours'; end if;
  insert into public.bar_hours_fixed (bar_id, week, src, n, cleared, set_at) values (p_bar_id, p_week, 'owner', 0, false, now())
  on conflict (bar_id) do update set week = excluded.week, src = 'owner', n = 0, cleared = false, set_at = now();
  return jsonb_build_object('ok', true, 'bar_id', p_bar_id, 'w', p_week);
end $$;
revoke all on function public.owner_set_bar_hours(text, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.owner_set_bar_hours(text, text, text[], boolean) to anon, authenticated;

create or replace function public.owner_place_signals(p_key text, p_weeks integer default 8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_w int := greatest(1, least(coalesce(p_weeks, 8), 104));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return coalesce((
    select jsonb_agg(x.j order by (x.j->'sig'->>'n')::int desc, x.j->>'name') from (
      select jsonb_build_object('bar_id', b.id, 'name', b.name, 'lat', b.lat, 'lng', b.lng, 'sig', s.sig) as j
        from public.bars_lite b
        cross join lateral (select public.olnu_place_signal(b.id, v_w) as sig) s
       where b.active
         and not exists (select 1 from public.bar_gone g where g.bar_id = b.id and g.status in ('hidden', 'confirmed'))
         and (b.id in (select c.bar_id from public.medal_checkins c)
              or b.id in (select g.bar_id from public.bar_gone_reports g where g.withdrawn_at is null)
              or b.id in (select r.bar_id from public.bar_hours_reports r where r.kind = 'no'))
         and (s.sig->>'n')::int >= 1
       limit 500) x), '[]'::jsonb);
end $$;
revoke all on function public.owner_place_signals(text, integer) from public, anon, authenticated;
grant execute on function public.owner_place_signals(text, integer) to anon, authenticated;

select public.olnu_strip_cr();
