-- 0450 after (A2, owner OK 10 Nov): the morning after report (swipe cards → 9:16 share card) + the morning push queue.
-- OWNER-RUN at release. Additive only: new tables (create table if not exists), new functions (create or replace).
-- No old table, function or policy changes. Safe to re-run.
--
--   after_flags            key → on_ (default false). Keys: morning_push (the ~11:00 push), push_ev (the client may ask
--                          notify-group for an instant flush), moments, moment_push, game_push (0451/0452 use them).
--   after_report2(g, n)    the night of one group for the report. Only members who were out (a drink_log row) or said
--                          Ikväll = ute that night. A ghost night (a ghost drink row or a ghost pin that night) is never in it.
--                          Home = after_nights.home_at only (already shown in the group as "✅ hemma"). Home AREAS for the
--                          share card come from olnu_replay_safe_points (0382): the ~500 m grid, never the exact spot.
--                          No drink counts in the answer (store rule: nothing rewards drinking more or faster).
--   after_push_q           one row per push to send (unique user + tag). Kinds: am (morning), mom (moments), game (GM4).
--   olnu_after_q_add(…)    queue helper: max 2 game pushes (mom + game) per person per night, 1 morning push.
--   after_push_due(p, by)  service role (notify-group cron): enqueue the morning rows (flag morning_push, 10:30–13:00
--                          Stockholm), then claim due rows (atomic UPDATE … RETURNING) for sending.
--   after_flags_get()      the flags for the client (not secret).

create table if not exists public.after_flags (
  key        text primary key,
  on_        boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.after_flags enable row level security;
revoke all on table public.after_flags from public, anon, authenticated;
insert into public.after_flags (key, on_) values
  ('morning_push', false), ('push_ev', false), ('moments', false), ('moment_push', false), ('game_push', false)
on conflict (key) do nothing;

create or replace function public.olnu_after_on(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.on_ from public.after_flags f where f.key = p_key), false);
$$;
revoke all on function public.olnu_after_on(text) from public, anon, authenticated;

create or replace function public.after_flags_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('v', 1, 'flags', coalesce((select jsonb_object_agg(f.key, f.on_) from public.after_flags f), '{}'::jsonb));
$$;

-- A ghost night: the user drank in Spökläge that night (drink_log.ghost) or had a ghost pin (same rule as 0382).
create or replace function public.olnu_after_ghost(p_uid uuid, p_night timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.drink_log d where d.user_id = p_uid and d.night = p_night and coalesce(d.ghost, false))
      or exists (select 1 from public.beers b where b.user_id = p_uid and b.expires_at = p_night
                  and (coalesce(b.ghost, false) or coalesce(b.prev_ghost, false)));
$$;

-- The people of one group for one night (participants only). Used by the report and the morning push.
create or replace function public.olnu_after_people(p_group uuid, p_night timestamptz)
returns table (user_id uuid, name text, joined_at timestamptz, first_at timestamptz, last_at timestamptz, first_place text,
               bars int, said_ute boolean, said_at timestamptz, home_at timestamptz, skal_given int, driver boolean, drank boolean)
language sql stable security definer set search_path = public as $$
  with mem as (
    select m.user_id, m.display_name, m.joined_at from public.group_members m
     where m.group_id = p_group and not public.olnu_after_ghost(m.user_id, p_night)
  ), act as (
    select d.user_id, min(d.at) as first_at, max(d.at) as last_at,
           count(distinct d.bar_id) filter (where d.bar_id is not null)::int as bars,
           bool_or(d.kind <> 'checkin') as drank
      from public.drink_log d join mem on mem.user_id = d.user_id
     where d.night = p_night and not d.undone and not coalesce(d.ghost, false)
     group by d.user_id
  )
  select mem.user_id, left(coalesce(mem.display_name, ''), 40), mem.joined_at, a.first_at, a.last_at,
         (select left(coalesce(x.bar_name, x.area), 60) from public.drink_log x
           where x.user_id = mem.user_id and x.night = p_night and not x.undone and not coalesce(x.ghost, false)
           order by x.at, x.id limit 1),
         coalesce(a.bars, 0),
         coalesce((select s.st = 'ute' from public.ikvall_status s where s.user_id = mem.user_id and s.night = p_night), false),
         (select s.updated_at from public.ikvall_status s where s.user_id = mem.user_id and s.night = p_night and s.st = 'ute'),
         an.home_at, coalesce(an.skal_given, 0),
         exists (select 1 from public.driver_status ds where ds.user_id = mem.user_id and ds.night = p_night),
         coalesce(a.drank, false)
    from mem
    left join act a on a.user_id = mem.user_id
    left join public.after_nights an on an.user_id = mem.user_id and an.night = p_night
   where a.first_at is not null
      or exists (select 1 from public.ikvall_status s where s.user_id = mem.user_id and s.night = p_night and s.st = 'ute');
$$;
revoke all on function public.olnu_after_people(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.olnu_after_ghost(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.after_report2(p_group_id uuid default null, p_night timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := now();
  v_night timestamptz;
  v_gid uuid := p_group_id;
  v_people jsonb; v_stops jsonb; v_homes jsonb; v_prev jsonb; v_groups jsonb; v_name text; v_prev_night timestamptz;
begin
  v_night := case when p_night is null then public.olnu_night_of(v_now - interval '24 hours') else public.olnu_night_of(p_night - interval '1 second') end;
  if v_night > public.olnu_night_of(v_now) or v_night < v_now - interval '15 days' then raise exception 'invalid_night'; end if;
  -- my groups with 2+ people that night (most people first; groups where I was in it first)
  select coalesce(jsonb_agg(jsonb_build_object('id', q.gid, 'name', q.gname, 'n', q.n, 'me', q.me) order by q.me desc, q.n desc, q.gname), '[]'::jsonb)
    into v_groups
    from (select g.id as gid, left(g.name, 40) as gname,
                 (select count(*) from public.olnu_after_people(g.id, v_night))::int as n,
                 exists (select 1 from public.olnu_after_people(g.id, v_night) p where p.user_id = v_uid) as me
            from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = v_uid
           where not exists (select 1 from public.dm_threads t where t.group_id = g.id)) q
   where q.n >= 2;
  if v_gid is null then
    v_gid := nullif(v_groups -> 0 ->> 'id', '')::uuid;
    if v_gid is null then
      return jsonb_build_object('v', 1, 'empty', true, 'night', v_night, 'evening', public.olnu_evening(v_night), 'groups', v_groups);
    end if;
  end if;
  if not public.olnu_crew_member(v_gid, v_uid) then raise exception 'not_member'; end if;
  select left(g.name, 40) into v_name from public.groups g where g.id = v_gid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_crew_k(v_gid, p.user_id), 'name', p.name, 'is_me', p.user_id = v_uid,
           'first_at', p.first_at, 'last_at', p.last_at, 'first_place', p.first_place, 'bars', p.bars,
           'said_ute', p.said_ute, 'said_at', p.said_at, 'home_at', p.home_at, 'skal', p.skal_given,
           'driver', p.driver and not p.drank, 'out', p.first_at is not null)
         order by p.first_at nulls last, p.joined_at), '[]'::jsonb)
    into v_people from public.olnu_after_people(v_gid, v_night) p;

  -- bar stops (bars are public places: exact), consecutive rows at the same bar collapse into one stop
  select coalesce(jsonb_agg(jsonb_build_object('k', s.k, 'at', s.at, 'bar_id', s.bar_id, 'name', s.name, 'lat', s.lat, 'lng', s.lng)
           order by s.at), '[]'::jsonb)
    into v_stops
    from (select public.olnu_crew_k(v_gid, x.user_id) as k, x.at, x.bar_id, left(coalesce(b.name, x.bar_name), 60) as name,
                   coalesce(b.lat, x.lat) as lat, coalesce(b.lng, x.lng) as lng
            from (select d.user_id, d.at, d.bar_id, d.bar_name, d.lat, d.lng,
                         lag(d.bar_id) over (partition by d.user_id order by d.at, d.id) as prev_bar
                    from public.drink_log d
                    join public.olnu_after_people(v_gid, v_night) p on p.user_id = d.user_id
                   where d.night = v_night and not d.undone and not coalesce(d.ghost, false) and d.bar_id is not null) x
            left join public.bars_lite b on b.id = x.bar_id
           where x.prev_bar is distinct from x.bar_id
           order by x.at limit 200) s;

  -- fuzzy home areas (~500 m grid cells, 0382): one per cell
  begin
    select coalesce(jsonb_agg(jsonb_build_object('lat', h.lat, 'lng', h.lng)), '[]'::jsonb) into v_homes
      from (select distinct round(q.lat::numeric, 4)::float8 as lat, round(q.lng::numeric, 4)::float8 as lng
              from public.olnu_replay_safe_points(v_gid, v_night) q where q.kind = 'area' limit 12) h;
  exception when others then v_homes := '[]'::jsonb;
  end;

  -- the previous night of this group with 2+ out (compare: home time, bars, people; never drinks)
  select d.night into v_prev_night
    from public.drink_log d join public.group_members m on m.user_id = d.user_id and m.group_id = v_gid
   where d.night < v_night and d.night > v_night - interval '60 days' and not d.undone and not coalesce(d.ghost, false)
   group by d.night having count(distinct d.user_id) >= 2
   order by d.night desc limit 1;
  if v_prev_night is not null then
    select jsonb_build_object('night', v_prev_night, 'evening', public.olnu_evening(v_prev_night),
             'n_out', count(*) filter (where p.first_at is not null),
             'first_at', min(p.first_at), 'last_home', max(p.home_at), 'last_at', max(p.last_at),
             'bars', (select count(distinct d.bar_id) from public.drink_log d join public.olnu_after_people(v_gid, v_prev_night) pp on pp.user_id = d.user_id
                       where d.night = v_prev_night and d.bar_id is not null and not d.undone and not coalesce(d.ghost, false)))
      into v_prev from public.olnu_after_people(v_gid, v_prev_night) p;
  end if;

  return jsonb_build_object('v', 1, 'night', v_night, 'evening', public.olnu_evening(v_night),
    'group', jsonb_build_object('id', v_gid, 'name', v_name), 'groups', v_groups,
    'people', v_people, 'stops', v_stops, 'homes', coalesce(v_homes, '[]'::jsonb), 'prev', v_prev,
    'ghost_me', public.olnu_after_ghost(v_uid, v_night),
    'bets', '[]'::jsonb, 'missions', '[]'::jsonb, 'agent', null);
end; $$;
revoke all on function public.after_report2(uuid, timestamptz) from public, anon;
grant execute on function public.after_report2(uuid, timestamptz) to authenticated, service_role;
revoke all on function public.after_flags_get() from public, anon;
grant execute on function public.after_flags_get() to authenticated, service_role;

-- ---------- the push queue ----------
create table if not exists public.after_push_q (
  id         bigserial primary key,
  user_id    uuid not null,
  night      timestamptz not null,
  kind       text not null check (kind in ('am', 'mom', 'game')),
  tag        text not null,
  title      text not null,
  body       text not null default '',
  url        text not null default '/',
  created_by uuid,
  created_at timestamptz not null default now(),
  due_at     timestamptz not null default now(),
  sent_at    timestamptz,
  unique (user_id, tag)
);
create index if not exists after_push_q_due_ix on public.after_push_q (due_at) where sent_at is null;
alter table public.after_push_q enable row level security;
revoke all on table public.after_push_q from public, anon, authenticated;
grant all on table public.after_push_q to service_role;

-- Queue one push. Max 2 game pushes (mom + game) per person per night; one row per user + tag. Returns true when queued.
create or replace function public.olnu_after_q_add(p_uid uuid, p_night timestamptz, p_kind text, p_tag text, p_title text,
                                                   p_body text, p_url text, p_by uuid default null, p_due timestamptz default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_uid is null then return false; end if;
  if p_kind in ('mom', 'game') then
    select count(*) into v_n from public.after_push_q q where q.user_id = p_uid and q.night = p_night and q.kind in ('mom', 'game');
    if v_n >= 2 then return false; end if;
  end if;
  insert into public.after_push_q (user_id, night, kind, tag, title, body, url, created_by, due_at)
  values (p_uid, p_night, p_kind, left(p_tag, 60), left(p_title, 60), left(coalesce(p_body, ''), 160), left(coalesce(p_url, '/'), 120), p_by, coalesce(p_due, now()))
  on conflict (user_id, tag) do nothing;
  return found;
end; $$;
revoke all on function public.olnu_after_q_add(uuid, timestamptz, text, text, text, text, text, uuid, timestamptz) from public, anon, authenticated;

-- Morning rows for last night: one per participant (best group = most people), 10:30–13:00 Stockholm, flag morning_push.
create or replace function public.olnu_after_morning_enqueue(p_test boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(now() - interval '24 hours');
  v_local timestamp := now() at time zone 'Europe/Stockholm';
  v_h numeric := extract(hour from v_local) + extract(minute from v_local) / 60.0;
  v_n int := 0; r record; v_ev text := to_char(public.olnu_evening(v_night), 'YYYYMMDD');
begin
  if not public.olnu_after_on('morning_push') and not coalesce(p_test, false) then return 0; end if;
  if (v_h < 10.5 or v_h >= 13) and not coalesce(p_test, false) then return 0; end if;
  for r in
    with outp as (
      select distinct d.user_id from public.drink_log d
       where d.night = v_night and not d.undone and not coalesce(d.ghost, false)
         and not exists (select 1 from public.after_push_q q where q.user_id = d.user_id and q.tag = 'olnu-after-am-' || v_ev)
    ), cand as (
      select o.user_id, g.id as gid, left(g.name, 30) as gname,
             (select count(*) from public.olnu_after_people(g.id, v_night) pp where pp.first_at is not null)::int as n,
             (select count(distinct d.bar_id) from public.drink_log d join public.group_members mm on mm.user_id = d.user_id and mm.group_id = g.id
               where d.night = v_night and d.bar_id is not null and not d.undone and not coalesce(d.ghost, false))::int as bars
        from outp o join public.group_members m on m.user_id = o.user_id join public.groups g on g.id = m.group_id
       where not exists (select 1 from public.dm_threads t where t.group_id = g.id)
         and not public.olnu_after_ghost(o.user_id, v_night)
    )
    select distinct on (c.user_id) c.* from cand c where c.n >= 2 order by c.user_id, c.n desc, c.gname
  loop
    if public.olnu_after_q_add(r.user_id, v_night, 'am', 'olnu-after-am-' || v_ev, 'Kvällsrapporten ä klar 📋',
         r.gname || ': ' || r.n || ' ute' || case when r.bars > 0 then ', ' || r.bars || case when r.bars = 1 then ' krog' else ' krogar' end else '' end
         || '. Vem blev kvällens kapten?', '/?after=' || r.gid::text, null, now()) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end; $$;
revoke all on function public.olnu_after_morning_enqueue(boolean) from public, anon, authenticated;

-- notify-group (cron, or {event:"after_q"} with p_by = the caller): claim due rows. Rows older than 3 h are never sent.
create or replace function public.after_push_due(p_limit int default 200, p_by uuid default null)
returns table (uid uuid, kind text, tag text, title text, body text, url text, has_sub boolean)
language plpgsql security definer set search_path = public as $$
begin
  if p_by is null then perform public.olnu_after_morning_enqueue(false); end if;
  return query
  with due as (
    select q.id from public.after_push_q q
     where q.sent_at is null and q.due_at <= now() and q.due_at > now() - interval '3 hours'
       and (p_by is null or q.created_by = p_by)
       and ((q.kind = 'am' and public.olnu_after_on('morning_push'))
         or (q.kind = 'mom' and public.olnu_after_on('moment_push'))
         or (q.kind = 'game' and public.olnu_after_on('game_push')))
     order by q.id limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update skip locked
  ), upd as (
    update public.after_push_q q set sent_at = now() from due where q.id = due.id
    returning q.user_id, q.kind, q.tag, q.title, q.body, q.url
  )
  select u.user_id, u.kind, u.tag, u.title, u.body, u.url,
         exists (select 1 from public.push_subscriptions s where s.user_id = u.user_id)
    from upd u;
end; $$;
revoke all on function public.after_push_due(int, uuid) from public, anon, authenticated;
grant execute on function public.after_push_due(int, uuid) to service_role;
