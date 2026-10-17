-- Öl Nu v15 LEK (omgång 2). Additive. Safe to run again. Needs 0001-0014 (0015 optional).
-- Six small group games, all for "tonight" (night = the next 05:00 Europe/Stockholm, olnu_night_of):
--   1. Kvällens uppdrag   3 missions per user per night, checked from server facts (never "drink N beers").
--   2. Krogrunda          a member draws a route of 2-6 bars; members' check-ins tick the stops.
--   3. Hemlig agent       one random member who is out gets a secret (harmless) mission; next day the
--                         group guesses who it was (one vote each), reveal when all voted or at 12:00.
--   4. Gissa kvällen      guess before 21:00 how many beers the town (20 km) logs tonight; next day the
--                         closest guess in each group is "Dagens orakel".
--   5. Kvällsbingo        one 3x3 card per group per night, members tick squares (honour system).
--   6. Sugen-status       "sugen" / "kanske" / "inte" for tonight, seen by group-mates.
-- Medals (olnu_medal_eval_games): uppdrag, uppdrag3, runda, detektiv, spion, orakel, bingo.
-- olnu_medal_store is replaced by a version that merges olnu_medal_eval() with EVERY function named
-- public.olnu_medal_eval_<x>(uuid) (0014 bars, this file games, later files only add their own).
-- All texts live in the client (docs/js/games-content.js); the server only stores ids and numbers.
-- Every internal olnu_g_* function takes p_now so the night logic can be tested; the RPCs pass now().
-- This file has no remove-type statements on purpose (create-or-replace, "if not exists",
-- "on conflict" only). Rows are never removed: every read filters on the night.

-- 0015 adds this column too (same definition); needed here so a 0014-only database works.
alter table public.beer_events add column if not exists undone boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS on, no policies, no client access)
-- ---------------------------------------------------------------------------
create table if not exists public.game_mission_cat (
  id          text primary key check (id ~ '^m[0-9]{3}$'),
  kind        text not null check (kind in ('checkin_bars', 'skal_give', 'skal_get', 'chat', 'rally_yes', 'group_out',
                                            'home', 'water', 'beer_type', 'queue_report', 'tip', 'early', 'other_none')),
  goal        int  not null check (goal between 1 and 50),
  needs_group boolean not null default false,
  active      boolean not null default true
);

create table if not exists public.game_missions (
  user_id    uuid not null,
  night      timestamptz not null,
  slot       smallint not null check (slot between 1 and 3),
  mission    text not null,
  kind       text not null,
  goal       int  not null,
  progress   int  not null default 0,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, night, slot)
);
create index if not exists game_missions_done_idx on public.game_missions (user_id, done_at);

-- Facts the server cannot see elsewhere: water taps, "Jag är hemma" time, bingo tick changes.
create table if not exists public.game_facts (
  user_id       uuid not null,
  night         timestamptz not null,
  water         int not null default 0,
  water_at      timestamptz,
  home_at       timestamptz,
  bingo_changes int not null default 0,
  primary key (user_id, night)
);

create table if not exists public.game_sugen (
  user_id    uuid not null,
  night      timestamptz not null,
  status     text not null check (status in ('sugen', 'kanske', 'inte', 'none')),
  changes    int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, night)
);

create table if not exists public.game_crawls (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  night      timestamptz not null,
  stops      jsonb not null,
  n          int not null check (n between 2 and 6),
  created_at timestamptz not null default now(),
  closed     boolean not null default false,
  done_at    timestamptz
);
create index if not exists game_crawls_group_idx on public.game_crawls (group_id, night);
create index if not exists game_crawls_user_idx  on public.game_crawls (user_id, created_at);

create table if not exists public.game_agents (
  group_id    uuid not null,
  night       timestamptz not null,
  agent       uuid not null,
  mission     int not null,
  started_by  uuid not null,
  created_at  timestamptz not null default now(),
  revealed_at timestamptz,
  correct     int,
  votes       int,
  primary key (group_id, night)
);
create index if not exists game_agents_agent_idx on public.game_agents (agent);

create table if not exists public.game_agent_votes (
  group_id   uuid not null,
  night      timestamptz not null,
  voter      uuid not null,
  suspect    uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, night, voter)
);
create index if not exists game_agent_votes_voter_idx on public.game_agent_votes (voter);

create table if not exists public.game_guesses (
  user_id    uuid not null,
  night      timestamptz not null,
  guess      int not null check (guess between 0 and 20000),
  town       text not null check (char_length(town) between 1 and 40),
  lat        float8 not null,
  lng        float8 not null,
  changes    int not null default 1,
  real       int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, night)
);
create index if not exists game_guesses_night_idx on public.game_guesses (night);

-- "Dagens orakel": the best guess per group for a finished night (only groups with 2+ guesses).
create table if not exists public.game_oracles (
  group_id   uuid not null,
  night      timestamptz not null,
  user_id    uuid not null,
  guess      int not null,
  real       int not null,
  err        float8 not null,
  guessers   int not null,
  created_at timestamptz not null default now(),
  primary key (group_id, night)
);
create index if not exists game_oracles_user_idx on public.game_oracles (user_id);

create table if not exists public.game_bingo_cards (
  group_id   uuid not null,
  night      timestamptz not null,
  card       int[] not null,
  n          int not null,
  lines      int not null default 0,
  bingo_at   timestamptz,
  created_at timestamptz not null default now(),
  primary key (group_id, night)
);

create table if not exists public.game_bingo_ticks (
  group_id   uuid not null,
  night      timestamptz not null,
  idx        smallint not null check (idx between 0 and 8),
  user_id    uuid not null,
  ticked     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (group_id, night, idx)
);
create index if not exists game_bingo_ticks_user_idx on public.game_bingo_ticks (user_id);

do $$
declare
  t text;
  tabs text[] := array['game_mission_cat', 'game_missions', 'game_facts', 'game_sugen', 'game_crawls', 'game_agents',
                       'game_agent_votes', 'game_guesses', 'game_oracles', 'game_bingo_cards', 'game_bingo_ticks'];
begin
  foreach t in array tabs loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on table public.%I to service_role', t);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on sequence public.game_crawls_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on sequence public.game_crawls_id_seq from authenticated';
  end if;
end $$;

-- Mission catalog (ids = docs/js/games-content.js; texts only in the client).
-- needs_group: only given to users who are in a group when the missions are assigned.
insert into public.game_mission_cat (id, kind, goal, needs_group) values
  ('m001', 'checkin_bars', 2, false),
  ('m002', 'checkin_bars', 3, false),
  ('m003', 'checkin_bars', 2, false),
  ('m004', 'checkin_bars', 3, false),
  ('m005', 'checkin_bars', 2, false),
  ('m006', 'checkin_bars', 4, false),
  ('m007', 'checkin_bars', 2, false),
  ('m008', 'checkin_bars', 3, false),
  ('m009', 'checkin_bars', 2, false),
  ('m010', 'checkin_bars', 3, false),
  ('m011', 'checkin_bars', 2, false),
  ('m012', 'checkin_bars', 2, false),
  ('m013', 'checkin_bars', 3, false),
  ('m014', 'checkin_bars', 2, false),
  ('m015', 'checkin_bars', 3, false),
  ('m016', 'checkin_bars', 2, false),
  ('m017', 'skal_give', 3, false),
  ('m018', 'skal_give', 5, false),
  ('m019', 'skal_give', 1, false),
  ('m020', 'skal_give', 3, false),
  ('m021', 'skal_give', 2, false),
  ('m022', 'skal_give', 4, false),
  ('m023', 'skal_give', 3, false),
  ('m024', 'skal_give', 10, false),
  ('m025', 'skal_give', 2, false),
  ('m026', 'skal_give', 5, false),
  ('m027', 'skal_give', 3, false),
  ('m028', 'skal_give', 1, false),
  ('m029', 'skal_get', 3, false),
  ('m030', 'skal_get', 5, false),
  ('m031', 'skal_get', 1, false),
  ('m032', 'skal_get', 2, false),
  ('m033', 'skal_get', 3, false),
  ('m034', 'skal_get', 4, false),
  ('m035', 'skal_get', 2, false),
  ('m036', 'skal_get', 10, false),
  ('m037', 'skal_get', 3, false),
  ('m038', 'skal_get', 6, false),
  ('m039', 'chat', 1, true),
  ('m040', 'chat', 3, true),
  ('m041', 'chat', 5, true),
  ('m042', 'chat', 1, true),
  ('m043', 'chat', 2, true),
  ('m044', 'chat', 3, true),
  ('m045', 'chat', 1, true),
  ('m046', 'chat', 4, true),
  ('m047', 'chat', 2, true),
  ('m048', 'chat', 10, true),
  ('m049', 'rally_yes', 1, true),
  ('m050', 'rally_yes', 1, true),
  ('m051', 'rally_yes', 2, true),
  ('m052', 'rally_yes', 1, true),
  ('m053', 'rally_yes', 1, true),
  ('m054', 'rally_yes', 1, true),
  ('m055', 'rally_yes', 3, true),
  ('m056', 'group_out', 3, true),
  ('m057', 'group_out', 4, true),
  ('m058', 'group_out', 2, true),
  ('m059', 'group_out', 5, true),
  ('m060', 'group_out', 3, true),
  ('m061', 'group_out', 6, true),
  ('m062', 'group_out', 3, true),
  ('m063', 'group_out', 4, true),
  ('m064', 'group_out', 2, true),
  ('m065', 'group_out', 8, true),
  ('m066', 'home', 1, false),
  ('m067', 'home', 1, false),
  ('m068', 'home', 1, false),
  ('m069', 'home', 1, false),
  ('m070', 'home', 1, false),
  ('m071', 'home', 1, false),
  ('m072', 'home', 1, false),
  ('m073', 'home', 1, false),
  ('m074', 'home', 1, false),
  ('m075', 'home', 1, false),
  ('m076', 'water', 1, false),
  ('m077', 'water', 2, false),
  ('m078', 'water', 3, false),
  ('m079', 'water', 4, false),
  ('m080', 'water', 1, false),
  ('m081', 'water', 2, false),
  ('m082', 'water', 3, false),
  ('m083', 'water', 5, false),
  ('m084', 'water', 2, false),
  ('m085', 'water', 3, false),
  ('m086', 'water', 2, false),
  ('m087', 'water', 4, false),
  ('m088', 'beer_type', 2, false),
  ('m089', 'beer_type', 3, false),
  ('m090', 'beer_type', 2, false),
  ('m091', 'beer_type', 2, false),
  ('m092', 'beer_type', 2, false),
  ('m093', 'beer_type', 3, false),
  ('m094', 'beer_type', 2, false),
  ('m095', 'beer_type', 2, false),
  ('m096', 'beer_type', 2, false),
  ('m097', 'beer_type', 3, false),
  ('m098', 'queue_report', 1, false),
  ('m099', 'queue_report', 2, false),
  ('m100', 'queue_report', 1, false),
  ('m101', 'queue_report', 3, false),
  ('m102', 'queue_report', 1, false),
  ('m103', 'queue_report', 2, false),
  ('m104', 'queue_report', 1, false),
  ('m105', 'queue_report', 2, false),
  ('m106', 'tip', 1, true),
  ('m107', 'tip', 1, true),
  ('m108', 'tip', 2, true),
  ('m109', 'tip', 1, true),
  ('m110', 'tip', 1, true),
  ('m111', 'tip', 1, true),
  ('m112', 'tip', 3, true),
  ('m113', 'tip', 1, true),
  ('m114', 'early', 1, false),
  ('m115', 'early', 1, false),
  ('m116', 'early', 1, false),
  ('m117', 'early', 1, false),
  ('m118', 'early', 1, false),
  ('m119', 'early', 1, false),
  ('m120', 'early', 1, false),
  ('m121', 'early', 1, false),
  ('m122', 'other_none', 1, false),
  ('m123', 'other_none', 1, false),
  ('m124', 'other_none', 1, false),
  ('m125', 'other_none', 1, false),
  ('m126', 'other_none', 1, false),
  ('m127', 'other_none', 1, false),
  ('m128', 'other_none', 1, false),
  ('m129', 'other_none', 1, false)
on conflict (id) do update
   set kind = excluded.kind, goal = excluded.goal, needs_group = excluded.needs_group, active = true;

-- ---------------------------------------------------------------------------
-- 2. Helpers (internal, not callable by clients)
-- ---------------------------------------------------------------------------

-- The night before p_night (local calendar arithmetic, DST-correct).
create or replace function public.olnu_g_prev(p_night timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select ((p_night at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$$;

-- Stable opaque key for a member inside one group (never the user id).
create or replace function public.olnu_g_key(p_group uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-game'), 1, 12);
$$;

-- Out right now: a visible live pin (not stopped, so ghost pins never count) or a live check-in.
create or replace function public.olnu_g_live(p_uid uuid, p_night timestamptz, p_now timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select p_now < p_night and (
    exists (select 1 from public.beers b
             where b.user_id = p_uid and b.expires_at = p_night and not b.stopped
               and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1))
    or exists (select 1 from public.checkins c where c.user_id = p_uid and c.expires_at = p_night));
$$;

-- Has been out tonight (any beer / other drink logged, ghost too, or a check-in).
create or replace function public.olnu_g_outtonight(p_uid uuid, p_night timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.medal_nights mn
                  where mn.user_id = p_uid and mn.night = p_night and (mn.beers >= 1 or mn.others >= 1))
      or exists (select 1 from public.beers b
                  where b.user_id = p_uid and b.expires_at = p_night and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1))
      or exists (select 1 from public.checkins c where c.user_id = p_uid and c.expires_at = p_night)
      or exists (select 1 from public.medal_checkins m where m.user_id = p_uid and m.night = p_night);
$$;

-- Beers logged tonight within 20 km of a point (anonymous heat events; undone and ghost beers excluded).
create or replace function public.olnu_g_real(p_night timestamptz, p_lat float8, p_lng float8)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.beer_events e
   where e.kind = 'beer' and not e.undone and e.expires_at = p_night
     and e.lat between p_lat - 0.19 and p_lat + 0.19
     and e.lng between p_lng - 0.56 and p_lng + 0.56
     and public.olnu_dist_m(p_lat, p_lng, e.lat, e.lng) <= 20000;
$$;

-- Number of bingo lines (rows, columns, diagonals) in a set of ticked squares 0-8.
create or replace function public.olnu_g_lines(p_t int[])
returns int language sql immutable set search_path = public as $$
  select count(*)::int from (values (array[0,1,2]), (array[3,4,5]), (array[6,7,8]), (array[0,3,6]),
                                    (array[1,4,7]), (array[2,5,8]), (array[0,4,8]), (array[2,4,6])) l(a)
   where l.a <@ coalesce(p_t, '{}'::int[]);
$$;

create or replace function public.olnu_g_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$$;

-- ---------------------------------------------------------------------------
-- 3. Missions
-- ---------------------------------------------------------------------------

-- Progress of one mission kind tonight, from server facts only. Never counts beers drunk.
create or replace function public.olnu_g_progress(p_uid uuid, p_night timestamptz, p_kind text, p_now timestamptz)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v      int := 0;
  v_from timestamptz := p_night - interval '30 hours';
  v_eve  timestamp := public.olnu_evening(p_night)::timestamp;
  v_beers int; v_others int; v_first timestamptz; v_home timestamptz;
begin
  begin
    if p_kind = 'checkin_bars' then
      select count(distinct c.bar_id) into v from public.medal_checkins c where c.user_id = p_uid and c.night = p_night;
    elsif p_kind = 'skal_give' then
      select count(*) into v from public.skals s
       where s.user_id = p_uid and s.created_at > v_from and public.olnu_night_of(s.created_at) = p_night;
    elsif p_kind = 'skal_get' then
      select count(distinct s.user_id) into v from public.skals s join public.beers b on b.id = s.beer_id
       where b.user_id = p_uid and b.expires_at = p_night and s.user_id <> p_uid;
    elsif p_kind = 'chat' then
      select count(*) into v from public.group_msgs m
       where m.user_id = p_uid and m.created_at > v_from and public.olnu_night_of(m.created_at) = p_night;
    elsif p_kind = 'rally_yes' then
      select count(*) into v from public.rally_answers a join public.rallies r on r.id = a.rally_id
       where a.user_id = p_uid and a.answer = 'yes' and r.user_id <> p_uid and r.expires_at = p_night;
    elsif p_kind = 'group_out' then
      select coalesce(max(x.n), 0) into v from (
        select gm.group_id, count(*) filter (where public.olnu_g_live(o.user_id, p_night, p_now)) as n
          from public.group_members gm join public.group_members o on o.group_id = gm.group_id
         where gm.user_id = p_uid
         group by gm.group_id) x;
    elsif p_kind = 'water' then
      select coalesce(max(f.water), 0) into v from public.game_facts f where f.user_id = p_uid and f.night = p_night;
    elsif p_kind = 'beer_type' then
      select count(distinct t.type) into v from public.beer_types t
       where t.user_id = p_uid and t.night = p_night and t.type <> 'annan';
    elsif p_kind = 'queue_report' then
      select count(*) into v from public.bar_queue q
       where q.user_id = p_uid and q.created_at > v_from and public.olnu_night_of(q.created_at) = p_night;
    elsif p_kind = 'tip' then
      select count(*) into v from public.bar_tips t
       where t.user_id = p_uid and t.created_at > v_from and public.olnu_night_of(t.created_at) = p_night;
    elsif p_kind in ('home', 'early', 'other_none') then
      select mn.beers, mn.others, mn.first_at into v_beers, v_others, v_first
        from public.medal_nights mn where mn.user_id = p_uid and mn.night = p_night;
      select f.home_at into v_home from public.game_facts f where f.user_id = p_uid and f.night = p_night;
      if p_kind = 'home' then
        -- "Jag är hemma" after the first beer and before 02:00 (local wall clock).
        if coalesce(v_beers, 0) >= 1 and v_first is not null and v_home is not null and v_home >= v_first
           and (v_home at time zone 'Europe/Stockholm') < (p_night at time zone 'Europe/Stockholm') - interval '3 hours' then
          v := 1;
        end if;
      elsif p_kind = 'early' then
        if coalesce(v_beers, 0) >= 1 and v_first is not null
           and (v_first at time zone 'Europe/Stockholm') < v_eve + interval '20 hours' then
          v := 1;
        end if;
      else
        -- Only beer tonight: checked from 23:00 (or after "Jag är hemma").
        if coalesce(v_beers, 0) >= 1 and coalesce(v_others, 0) = 0
           and ((p_now at time zone 'Europe/Stockholm') >= v_eve + interval '23 hours' or v_home is not null) then
          v := 1;
        end if;
      end if;
    end if;
  exception when others then
    v := 0;
  end;
  return coalesce(v, 0);
end;
$$;

-- Give the 3 missions of a night once (deterministic from user + night; stored, so a reload never
-- changes them). 3 different kinds. Group missions only for users in a group. "early" is not given
-- from 19:00 and "home" not from 01:00 (too late to do them).
create or replace function public.olnu_g_assign(p_uid uuid, p_night timestamptz, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group boolean := exists (select 1 from public.group_members m where m.user_id = p_uid);
  v_h     int := extract(hour from (p_now at time zone 'Europe/Stockholm'))::int;
  v_seed  text := p_uid::text || ':' || (extract(epoch from p_night)::bigint)::text;
begin
  if exists (select 1 from public.game_missions gm where gm.user_id = p_uid and gm.night = p_night) then
    return;
  end if;
  insert into public.game_missions (user_id, night, slot, mission, kind, goal)
  select p_uid, p_night, x.rn, x.id, x.kind, x.goal from (
    select y.id, y.kind, y.goal, row_number() over (order by y.h) as rn from (
      select distinct on (c.kind) c.id, c.kind, c.goal, md5(v_seed || ':' || c.id) as h
        from public.game_mission_cat c
       where c.active and (v_group or not c.needs_group)
         and not (c.kind = 'early' and (v_h >= 19 or v_h < 5))
         and not (c.kind = 'home' and v_h >= 1 and v_h < 5)
       order by c.kind, md5(v_seed || ':' || c.id)) y) x
   where x.rn <= 3
  on conflict do nothing;
end;
$$;

-- The caller's own game state tonight (missions with progress, guess, sugen, agent missions).
create or replace function public.olnu_g_me(p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_prev  timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_close timestamptz := (public.olnu_evening(public.olnu_night_of(p_now))::timestamp + interval '21 hours') at time zone 'Europe/Stockholm';
  r record;
  v_p int;
  v_m jsonb := '[]'::jsonb;
  v_done int := 0;
  v_fresh boolean;
  v_guess jsonb := null;
  v_gprev jsonb := null;
  v_g record;
  v_real int;
  v_f record;
  v_sugen text;
  v_agents jsonb;
  v_tlat float8; v_tlng float8;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  perform public.olnu_g_assign(p_uid, v_night, p_now);
  for r in select * from public.game_missions gm where gm.user_id = p_uid and gm.night = v_night order by gm.slot loop
    v_fresh := false;
    if r.done_at is null then
      v_p := least(r.goal, public.olnu_g_progress(p_uid, v_night, r.kind, p_now));
      if v_p >= r.goal then
        update public.game_missions gm set progress = v_p, done_at = p_now
         where gm.user_id = p_uid and gm.night = v_night and gm.slot = r.slot and gm.done_at is null;
        v_fresh := true;
        r.done_at := p_now;
      elsif v_p <> r.progress then
        update public.game_missions gm set progress = v_p
         where gm.user_id = p_uid and gm.night = v_night and gm.slot = r.slot;
      end if;
    else
      v_p := r.goal;
    end if;
    if r.done_at is not null then v_done := v_done + 1; end if;
    v_m := v_m || jsonb_build_object('slot', r.slot, 'id', r.mission, 'kind', r.kind, 'goal', r.goal,
      'progress', v_p, 'done', r.done_at is not null, 'fresh', v_fresh, 'done_at', r.done_at);
  end loop;

  select * into v_g from public.game_guesses g where g.user_id = p_uid and g.night = v_night;
  if found then
    v_guess := jsonb_build_object('guess', v_g.guess, 'town', v_g.town);
    v_tlat := v_g.lat; v_tlng := v_g.lng;
  end if;
  select * into v_g from public.game_guesses g where g.user_id = p_uid and g.night = v_prev;
  if found then
    v_real := v_g.real;
    if v_real is null then
      v_real := public.olnu_g_real(v_prev, v_g.lat, v_g.lng);
      update public.game_guesses g set real = v_real where g.user_id = p_uid and g.night = v_prev and g.real is null;
    end if;
    v_gprev := jsonb_build_object('guess', v_g.guess, 'town', v_g.town, 'real', v_real);
  end if;

  select f.water, f.home_at into v_f from public.game_facts f where f.user_id = p_uid and f.night = v_night;
  select s.status into v_sugen from public.game_sugen s where s.user_id = p_uid and s.night = v_night;

  select coalesce(jsonb_agg(jsonb_build_object('group_id', a.group_id, 'group_name', g.name, 'mission', a.mission)), '[]'::jsonb)
    into v_agents
    from public.game_agents a join public.groups g on g.id = a.group_id
   where a.agent = p_uid and a.night = v_night
     and exists (select 1 from public.group_members m where m.group_id = a.group_id and m.user_id = p_uid);

  return jsonb_build_object(
    'night', v_night, 'missions', v_m, 'done_n', v_done,
    'water', coalesce(v_f.water, 0), 'home_at', v_f.home_at,
    'guess', v_guess, 'guess_open', p_now < v_close, 'guess_closes', v_close,
    'guess_so_far', case when p_now >= v_close and v_guess is not null
                         then public.olnu_g_real(v_night, v_tlat, v_tlng) end,
    'guess_prev', v_gprev,
    'sugen', case when v_sugen = 'none' then null else v_sugen end,
    'out', public.olnu_g_outtonight(p_uid, v_night),
    'agent', v_agents);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Group games: lazy end-of-night steps (idempotent)
-- ---------------------------------------------------------------------------

-- Hemlig agent: reveal after 05:00 when every member except the agent has voted, or at 12:00 local.
create or replace function public.olnu_g_reveal(p_group uuid, p_night timestamptz, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.game_agents a
     set revealed_at = p_now,
         correct = (select count(*) from public.game_agent_votes v
                     where v.group_id = a.group_id and v.night = a.night and v.suspect = a.agent),
         votes = (select count(*) from public.game_agent_votes v where v.group_id = a.group_id and v.night = a.night)
   where a.group_id = p_group and a.night = p_night and a.revealed_at is null and p_now >= p_night
     and (p_now >= ((p_night at time zone 'Europe/Stockholm') + interval '7 hours') at time zone 'Europe/Stockholm'
          or (select count(*) from public.game_agent_votes v where v.group_id = a.group_id and v.night = a.night)
             >= (select count(*) from public.group_members m where m.group_id = p_group and m.user_id <> a.agent));
end;
$$;

-- Gissa kvällen: the best guess of a finished night in one group (needs 2+ guesses by current members).
create or replace function public.olnu_g_oracle(p_group uuid, p_night timestamptz, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_now < p_night or exists (select 1 from public.game_oracles o where o.group_id = p_group and o.night = p_night) then
    return;
  end if;
  update public.game_guesses g set real = public.olnu_g_real(g.night, g.lat, g.lng)
   where g.night = p_night and g.real is null
     and g.user_id in (select m.user_id from public.group_members m where m.group_id = p_group);
  insert into public.game_oracles (group_id, night, user_id, guess, real, err, guessers)
  select p_group, p_night, x.user_id, x.guess, x.real, x.err, x.cnt from (
    select g.user_id, g.guess, g.real, g.created_at,
           abs(g.guess - g.real)::float8 / greatest(g.real, 1) as err,
           count(*) over () as cnt
      from public.game_guesses g
      join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = p_night and g.real is not null) x
   where x.cnt >= 2
   order by x.err, x.created_at, x.user_id
   limit 1
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Group state (one group). p_full = the group sheet; else a compact summary for the poll.
-- ---------------------------------------------------------------------------
create or replace function public.olnu_g_group(p_uid uuid, p_group uuid, p_now timestamptz,
                                               p_full boolean default false, p_bingo_n int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_prev  timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_out   jsonb := '{}'::jsonb;
  v_j     jsonb;
  v_c     record;
  v_stops jsonb;
  v_dn    int;
  v_card  record;
  v_t     int[];
  v_ticks jsonb;
  v_a     record;
  v_n     int;
  v_bn    int := greatest(9, least(400, coalesce(p_bingo_n, 40)));
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;

  -- Sugen-status tonight (visible members only; "out" = visible pin or check-in right now).
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = p_uid, 'status', s.status, 'at', s.updated_at,
           'out', public.olnu_g_live(m.user_id, v_night, p_now)) order by s.updated_at desc), '[]'::jsonb)
    into v_j
    from public.group_members m
    join public.game_sugen s on s.user_id = m.user_id and s.night = v_night and s.status <> 'none'
   where m.group_id = p_group;
  v_out := v_out || jsonb_build_object('sugen', v_j);

  -- Krogrunda: the newest open route tonight. A stop is done when a member checked in there tonight.
  select * into v_c from public.game_crawls c
   where c.group_id = p_group and c.night = v_night and not c.closed order by c.id desc limit 1;
  if found then
    select jsonb_agg(jsonb_build_object('i', s.ord - 1, 'id', s.v->>'id', 'name', s.v->>'name',
             'lat', (s.v->>'lat')::float8, 'lng', (s.v->>'lng')::float8, 'done', w.names is not null,
             'who', case when p_full then w.names end) order by s.ord),
           count(*) filter (where w.names is not null)
      into v_stops, v_dn
      from jsonb_array_elements(v_c.stops) with ordinality s(v, ord)
      left join lateral (
        select jsonb_agg(m.display_name order by m.display_name) as names
          from public.group_members m
          join public.medal_checkins mc on mc.user_id = m.user_id and mc.night = v_night and mc.bar_id = s.v->>'id'
         where m.group_id = p_group) w on true;
    if v_dn >= v_c.n and v_c.done_at is null then
      update public.game_crawls c set done_at = p_now where c.id = v_c.id and c.done_at is null;
      v_c.done_at := p_now;
    end if;
    v_out := v_out || jsonb_build_object('crawl', jsonb_build_object(
      'id', v_c.id, 'n', v_c.n, 'done_n', v_dn, 'done', v_c.done_at is not null, 'done_at', v_c.done_at,
      'is_mine', v_c.user_id = p_uid, 'created_at', v_c.created_at,
      'by', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_c.user_id),
      'stops', v_stops));
  else
    v_out := v_out || jsonb_build_object('crawl', null);
  end if;

  -- Kvällsbingo: the group sheet makes tonight's card (9 different square numbers below p_bingo_n).
  select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  if not found and p_full then
    insert into public.game_bingo_cards (group_id, night, card, n)
    select p_group, v_night, array_agg(z.x), v_bn
      from (select x from generate_series(0, v_bn - 1) x order by random() limit 9) z
    on conflict do nothing;
    select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  end if;
  if v_card.group_id is not null then
    select array_agg(t.idx::int order by t.idx),
           jsonb_agg(jsonb_build_object('idx', t.idx, 'name', m.display_name, 'is_me', t.user_id = p_uid) order by t.idx)
      into v_t, v_ticks
      from public.game_bingo_ticks t
      left join public.group_members m on m.group_id = p_group and m.user_id = t.user_id
     where t.group_id = p_group and t.night = v_night and t.ticked;
    v_out := v_out || jsonb_build_object('bingo', jsonb_build_object(
      'card', case when p_full then to_jsonb(v_card.card) end, 'n', v_card.n,
      'ticks', case when p_full then coalesce(v_ticks, '[]'::jsonb) else to_jsonb(coalesce(array_length(v_t, 1), 0)) end,
      'lines', public.olnu_g_lines(v_t), 'bingo_at', v_card.bingo_at));
  else
    v_out := v_out || jsonb_build_object('bingo', null);
  end if;

  -- Hemlig agent tonight. Only the agent sees the mission.
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_night;
  if found then
    v_out := v_out || jsonb_build_object('agent', jsonb_build_object(
      'active', true, 'is_me', v_a.agent = p_uid, 'mission', case when v_a.agent = p_uid then v_a.mission end,
      'by', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_a.started_by)));
  else
    v_out := v_out || jsonb_build_object('agent', null);
  end if;

  -- Hemlig agent last night: voting from 05:00, reveal when all voted or at 12:00.
  begin
    perform public.olnu_g_reveal(p_group, v_prev, p_now);
  exception when others then
    null;
  end;
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_prev;
  if found then
    select count(*) into v_n from public.game_agent_votes v where v.group_id = p_group and v.night = v_prev;
    v_j := jsonb_build_object(
      'revealed', v_a.revealed_at is not null, 'voting', v_a.revealed_at is null,
      'reveal_at', ((v_prev at time zone 'Europe/Stockholm') + interval '7 hours') at time zone 'Europe/Stockholm',
      'votes', v_n,
      'needed', (select count(*) from public.group_members m where m.group_id = p_group and m.user_id <> v_a.agent),
      'is_agent', v_a.agent = p_uid,
      'my_vote', (select public.olnu_g_key(p_group, v.suspect) from public.game_agent_votes v
                   where v.group_id = p_group and v.night = v_prev and v.voter = p_uid),
      'mission', case when v_a.revealed_at is not null or v_a.agent = p_uid then v_a.mission end);
    if v_a.revealed_at is not null then
      v_j := v_j || jsonb_build_object(
        'agent_name', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_a.agent),
        'agent_k', public.olnu_g_key(p_group, v_a.agent), 'correct', coalesce(v_a.correct, 0),
        'correct_names', (select coalesce(jsonb_agg(m.display_name order by v.created_at), '[]'::jsonb)
                            from public.game_agent_votes v
                            join public.group_members m on m.group_id = p_group and m.user_id = v.voter
                           where v.group_id = p_group and v.night = v_prev and v.suspect = v_a.agent),
        'i_was_right', exists (select 1 from public.game_agent_votes v where v.group_id = p_group and v.night = v_prev
                                 and v.voter = p_uid and v.suspect = v_a.agent));
    end if;
    v_out := v_out || jsonb_build_object('agent_prev', v_j);
  else
    v_out := v_out || jsonb_build_object('agent_prev', null);
  end if;

  -- Gissa kvällen: "Dagens orakel" = best guess last night.
  begin
    perform public.olnu_g_oracle(p_group, v_prev, p_now);
  exception when others then
    null;
  end;
  select o.*, m.display_name into v_a from public.game_oracles o
    left join public.group_members m on m.group_id = p_group and m.user_id = o.user_id
   where o.group_id = p_group and o.night = v_prev;
  if found then
    v_out := v_out || jsonb_build_object('oracle', jsonb_build_object(
      'name', v_a.display_name, 'is_me', v_a.user_id = p_uid, 'guess', v_a.guess, 'real', v_a.real,
      'err', round(v_a.err::numeric, 3), 'guessers', v_a.guessers));
  else
    v_out := v_out || jsonb_build_object('oracle', null);
  end if;

  if p_full then
    -- Members (key for the agent vote), points, guesses.
    select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group, m.user_id), 'name', m.display_name,
             'is_me', m.user_id = p_uid, 'out', public.olnu_g_live(m.user_id, v_night, p_now)) order by m.joined_at), '[]'::jsonb)
      into v_j from public.group_members m where m.group_id = p_group;
    v_out := v_out || jsonb_build_object('members', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'is_me', x.is_me, 'pts', x.pts) order by x.pts desc, x.name), '[]'::jsonb)
      into v_j
      from (select m.display_name as name, m.user_id = p_uid as is_me,
                   (select count(*) from public.game_agent_votes v
                      join public.game_agents a on a.group_id = v.group_id and a.night = v.night
                     where v.group_id = p_group and v.voter = m.user_id and v.suspect = a.agent and a.revealed_at is not null)
                   + 2 * (select count(*) from public.game_agents a
                           where a.group_id = p_group and a.agent = m.user_id and a.revealed_at is not null
                             and coalesce(a.correct, 0) = 0 and coalesce(a.votes, 0) >= 1) as pts
              from public.group_members m where m.group_id = p_group) x
     where x.pts > 0;
    v_out := v_out || jsonb_build_object('points', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'is_me', m.user_id = p_uid,
             'guess', g.guess, 'real', g.real, 'town', g.town) order by abs(g.guess - coalesce(g.real, 0))), '[]'::jsonb)
      into v_j
      from public.game_guesses g join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = v_prev;
    v_out := v_out || jsonb_build_object('guesses_prev', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'is_me', m.user_id = p_uid) order by g.created_at), '[]'::jsonb)
      into v_j
      from public.game_guesses g join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = v_night;
    v_out := v_out || jsonb_build_object('guessed', v_j);
  end if;

  return v_out || jsonb_build_object('night', v_night);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Actions (internal versions take p_now; the RPCs below pass now())
-- ---------------------------------------------------------------------------

create or replace function public.olnu_g_water(p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_f record;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  insert into public.game_facts (user_id, night) values (p_uid, v_night) on conflict do nothing;
  select * into v_f from public.game_facts f where f.user_id = p_uid and f.night = v_night;
  if v_f.water_at is not null and v_f.water_at > p_now - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'water', v_f.water,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_f.water_at + interval '5 minutes' - p_now)))::int));
  end if;
  if v_f.water >= 10 then
    return jsonb_build_object('ok', false, 'water', v_f.water, 'wait_seconds', 0, 'reason', 'limit');
  end if;
  update public.game_facts f set water = f.water + 1, water_at = p_now where f.user_id = p_uid and f.night = v_night;
  return jsonb_build_object('ok', true, 'water', v_f.water + 1, 'wait_seconds', 0);
end;
$$;

-- "Jag är hemma": keeps the first press after tonight's first beer.
create or replace function public.olnu_g_home(p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_first timestamptz;
  v_home  timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select mn.first_at into v_first from public.medal_nights mn where mn.user_id = p_uid and mn.night = v_night;
  insert into public.game_facts as f (user_id, night, home_at) values (p_uid, v_night, p_now)
  on conflict (user_id, night) do update
     set home_at = case when f.home_at is null or (v_first is not null and f.home_at < v_first) then excluded.home_at
                        else f.home_at end
  returning f.home_at into v_home;
  return jsonb_build_object('ok', true, 'home_at', v_home);
end;
$$;

create or replace function public.olnu_g_sugen(p_uid uuid, p_status text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_s     text := lower(btrim(coalesce(p_status, '')));
  v_old   record;
begin
  if v_s = '' then v_s := 'none'; end if;
  if v_s not in ('sugen', 'kanske', 'inte', 'none') then
    raise exception 'invalid_status';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select * into v_old from public.game_sugen s where s.user_id = p_uid and s.night = v_night;
  if found then
    if v_old.status = v_s then
      return jsonb_build_object('status', case when v_s = 'none' then null else v_s end, 'changed', false);
    end if;
    if v_old.updated_at > p_now - interval '10 seconds' or v_old.changes >= 40 then
      raise exception 'slow_down';
    end if;
  end if;
  insert into public.game_sugen as s (user_id, night, status, updated_at) values (p_uid, v_night, v_s, p_now)
  on conflict (user_id, night) do update set status = excluded.status, updated_at = excluded.updated_at, changes = s.changes + 1;
  return jsonb_build_object('status', case when v_s = 'none' then null else v_s end, 'changed', true);
end;
$$;

create or replace function public.olnu_g_crawl(p_uid uuid, p_group uuid, p_stops jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_stops jsonb;
  v_n int; v_ids int; v_bad int;
  v_id bigint;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) not between 2 and 6 then
    raise exception 'invalid_crawl';
  end if;
  begin
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'lat', round(x.lat::numeric, 5)::float8,
             'lng', round(x.lng::numeric, 5)::float8) order by x.ord),
           count(*), count(distinct x.id),
           count(*) filter (where x.id is null or char_length(x.id) not between 1 and 80
                              or x.name is null or char_length(x.name) not between 1 and 60
                              or x.lat is null or x.lng is null
                              or x.lat not between 55.0 and 69.1 or x.lng not between 10.9 and 24.2)
      into v_stops, v_n, v_ids, v_bad
      from (select e.ord,
                   btrim(e.v->>'id') as id,
                   btrim(regexp_replace(regexp_replace(coalesce(e.v->>'name', ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')) as name,
                   (e.v->>'lat')::float8 as lat, (e.v->>'lng')::float8 as lng
              from jsonb_array_elements(p_stops) with ordinality e(v, ord)) x;
  exception when others then
    raise exception 'invalid_crawl';
  end;
  if v_bad > 0 or v_ids <> v_n then
    raise exception 'invalid_crawl';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  if exists (select 1 from public.game_crawls c where c.user_id = p_uid and c.created_at > p_now - interval '2 minutes'
                                                  and c.created_at <= p_now) then
    raise exception 'slow_down';
  end if;
  update public.game_crawls c set closed = true where c.group_id = p_group and c.night = v_night and not c.closed;
  insert into public.game_crawls (group_id, user_id, night, stops, n, created_at)
  values (p_group, p_uid, v_night, v_stops, v_n, p_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'n', v_n);
end;
$$;

create or replace function public.olnu_g_start_agent(p_uid uuid, p_group uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_a     record;
  v_agent uuid;
  v_out   int;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_agent:' || p_group::text, 0));
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_night;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'is_me', v_a.agent = p_uid);
  end if;
  if (select count(*) from public.group_members m where m.group_id = p_group) < 3 then
    raise exception 'not_enough';
  end if;
  select count(*) into v_out from public.group_members m
   where m.group_id = p_group and public.olnu_g_outtonight(m.user_id, v_night);
  if v_out < 2 then
    raise exception 'not_enough';
  end if;
  select m.user_id into v_agent from public.group_members m
   where m.group_id = p_group and public.olnu_g_outtonight(m.user_id, v_night)
   order by random() limit 1;
  insert into public.game_agents (group_id, night, agent, mission, started_by, created_at)
  values (p_group, v_night, v_agent, floor(random() * 1000)::int, p_uid, p_now)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'already', false, 'is_me', v_agent = p_uid);
end;
$$;

create or replace function public.olnu_g_vote(p_uid uuid, p_group uuid, p_member text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_a    record;
  v_s    uuid;
  v_new  boolean;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_agent:' || p_group::text, 0));
  perform public.olnu_g_reveal(p_group, v_prev, p_now);
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_prev;
  if not found or v_a.revealed_at is not null then
    raise exception 'no_agent';
  end if;
  if v_a.agent = p_uid then
    raise exception 'is_agent';
  end if;
  select m.user_id into v_s from public.group_members m
   where m.group_id = p_group and public.olnu_g_key(p_group, m.user_id) = btrim(coalesce(p_member, ''));
  if v_s is null or v_s = p_uid then
    raise exception 'invalid_suspect';
  end if;
  insert into public.game_agent_votes (group_id, night, voter, suspect, created_at)
  values (p_group, v_prev, p_uid, v_s, p_now)
  on conflict do nothing;
  v_new := found;
  perform public.olnu_g_reveal(p_group, v_prev, p_now);
  return jsonb_build_object('ok', true, 'already', not v_new,
    'revealed', exists (select 1 from public.game_agents a where a.group_id = p_group and a.night = v_prev and a.revealed_at is not null));
end;
$$;

create or replace function public.olnu_g_tick(p_uid uuid, p_group uuid, p_idx int, p_on boolean, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_card  record;
  v_t     record;
  v_ch    int;
  v_arr   int[];
  v_lines int;
  v_new   boolean := false;
  v_on    boolean := coalesce(p_on, true);
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  if p_idx is null or p_idx not between 0 and 8 then
    raise exception 'invalid_idx';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_bingo:' || p_group::text, 0));
  select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  if not found then
    raise exception 'no_card';
  end if;
  select * into v_t from public.game_bingo_ticks t where t.group_id = p_group and t.night = v_night and t.idx = p_idx;
  if (v_on and coalesce(v_t.ticked, false)) or (not v_on and not coalesce(v_t.ticked, false)) then
    null;   -- nothing to change
  else
    if not v_on and v_t.user_id <> p_uid then
      raise exception 'not_yours';
    end if;
    select f.bingo_changes into v_ch from public.game_facts f where f.user_id = p_uid and f.night = v_night;
    if coalesce(v_ch, 0) >= 100 then
      raise exception 'slow_down';
    end if;
    insert into public.game_facts as f (user_id, night, bingo_changes) values (p_uid, v_night, 1)
    on conflict (user_id, night) do update set bingo_changes = f.bingo_changes + 1;
    insert into public.game_bingo_ticks as t (group_id, night, idx, user_id, ticked, updated_at)
    values (p_group, v_night, p_idx, p_uid, v_on, p_now)
    on conflict (group_id, night, idx) do update set user_id = excluded.user_id, ticked = excluded.ticked, updated_at = excluded.updated_at;
  end if;
  select array_agg(t.idx::int order by t.idx) into v_arr from public.game_bingo_ticks t
   where t.group_id = p_group and t.night = v_night and t.ticked;
  v_lines := public.olnu_g_lines(v_arr);
  if v_lines > v_card.lines then
    update public.game_bingo_cards b set lines = v_lines, bingo_at = coalesce(b.bingo_at, p_now)
     where b.group_id = p_group and b.night = v_night;
    v_new := true;
  end if;
  return jsonb_build_object('ok', true, 'ticked', to_jsonb(coalesce(v_arr, '{}'::int[])), 'lines', v_lines, 'new_bingo', v_new);
end;
$$;

create or replace function public.olnu_g_guess(p_uid uuid, p_guess int, p_town text, p_lat float8, p_lng float8, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_close timestamptz := (public.olnu_evening(public.olnu_night_of(p_now))::timestamp + interval '21 hours') at time zone 'Europe/Stockholm';
  v_town  text := left(btrim(regexp_replace(regexp_replace(coalesce(p_town, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), 40);
  v_ch    int;
begin
  if p_now >= v_close then
    raise exception 'too_late';
  end if;
  if p_guess is null or p_guess not between 0 and 20000 then
    raise exception 'invalid_guess';
  end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng
     or p_lat not between 55.0 and 69.1 or p_lng not between 10.9 and 24.2 then
    raise exception 'outside_sweden';
  end if;
  if v_town = '' then v_town := 'Närområdet'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select g.changes into v_ch from public.game_guesses g where g.user_id = p_uid and g.night = v_night;
  if coalesce(v_ch, 0) >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.game_guesses as g (user_id, night, guess, town, lat, lng, created_at, updated_at)
  values (p_uid, v_night, p_guess, v_town, round(p_lat::numeric, 2)::float8, round(p_lng::numeric, 2)::float8, p_now, p_now)
  on conflict (user_id, night) do update
     set guess = excluded.guess, town = excluded.town, lat = excluded.lat, lng = excluded.lng,
         updated_at = excluded.updated_at, changes = g.changes + 1;
  return jsonb_build_object('ok', true, 'guess', p_guess, 'town', v_town, 'closes_at', v_close);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPCs (authenticated only; not_authenticated without a session)
-- ---------------------------------------------------------------------------

-- game_poll() -> jsonb {v, server_time, night, me, groups:[summary + id, name]} (max 20 groups).
create or replace function public.game_poll()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := now();
  v_me  jsonb;
  v_gs  jsonb;
begin
  v_me := public.olnu_g_me(v_uid, v_now);
  select coalesce(jsonb_agg(public.olnu_g_group(v_uid, x.id, v_now, false, null)
                            || jsonb_build_object('id', x.id, 'name', x.name) order by x.created_at), '[]'::jsonb)
    into v_gs
    from (select g.id, g.name, g.created_at from public.groups g
            join public.group_members m on m.group_id = g.id and m.user_id = v_uid
           order by g.created_at limit 20) x;
  return jsonb_build_object('v', 1, 'server_time', v_now, 'night', public.olnu_night_of(v_now), 'me', v_me, 'groups', v_gs);
end;
$$;

-- game_group(p_group_id, p_bingo_n default 40) -> jsonb, full state for the group sheet. Error: not_member.
create or replace function public.game_group(p_group_id uuid, p_bingo_n int default 40)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return public.olnu_g_group(v_uid, p_group_id, now(), true, p_bingo_n)
      || jsonb_build_object('id', p_group_id, 'name', (select g.name from public.groups g where g.id = p_group_id));
end;
$$;

create or replace function public.game_water()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_water(v_uid, now()); end; $$;

create or replace function public.game_home()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_home(v_uid, now()); end; $$;

create or replace function public.set_sugen(p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_sugen(v_uid, p_status, now()); end; $$;

create or replace function public.create_crawl(p_group_id uuid, p_stops jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_crawl(v_uid, p_group_id, p_stops, now()); end; $$;

-- close_crawl(p_crawl_id): the creator ends tonight's route. Error: crawl_not_found.
create or replace function public.close_crawl(p_crawl_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  update public.game_crawls c set closed = true
   where c.id = p_crawl_id and c.user_id = v_uid and c.night = public.olnu_night_of(now());
  if not found then
    raise exception 'crawl_not_found';
  end if;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.start_agent(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_start_agent(v_uid, p_group_id, now()); end; $$;

create or replace function public.vote_agent(p_group_id uuid, p_member text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_vote(v_uid, p_group_id, p_member, now()); end; $$;

create or replace function public.tick_bingo(p_group_id uuid, p_idx int, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_tick(v_uid, p_group_id, p_idx, p_on, now()); end; $$;

create or replace function public.guess_night(p_guess int, p_town text, p_lat float8, p_lng float8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_guess(v_uid, p_guess, p_town, p_lat, p_lng, now()); end; $$;

-- ---------------------------------------------------------------------------
-- 8. Medals
--    uppdrag   Uppdragstagaren   missions done (stacks)
--    uppdrag3  Fullt pådrag      nights with 3 of 3 missions (stacks)
--    runda     Rundvandraren     finished pub crawls with 2+ own stops (stacks)
--    detektiv  Detektiven        correct guesses of the secret agent (stacks)
--    spion     Mästerspionen     agent and nobody guessed right (needs 1+ vote; stacks)
--    orakel    Oraklet           best "Gissa kvällen" guess in a group (stacks)
--    bingo     Bingo!            nights where a group card got a line and you ticked a square (stacks)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_medal_eval_games(p_uid uuid)
returns table (medal text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_m int := 0; v_m3 int := 0; v_r int := 0; v_d int := 0; v_s int := 0; v_o int := 0; v_b int := 0;
begin
  begin
    select count(*) into v_m from public.game_missions gm where gm.user_id = p_uid and gm.done_at is not null;
    select count(*) into v_m3 from (
      select gm.night from public.game_missions gm where gm.user_id = p_uid and gm.done_at is not null
       group by gm.night having count(*) >= 3) x;
    select count(*) into v_r from public.game_crawls k
     where k.done_at is not null
       and k.group_id in (select m.group_id from public.group_members m where m.user_id = p_uid)
       and (select count(*) from jsonb_array_elements(k.stops) s
             where exists (select 1 from public.medal_checkins mc
                            where mc.user_id = p_uid and mc.night = k.night and mc.bar_id = s->>'id')) >= 2;
    select count(*) into v_d from public.game_agent_votes v
      join public.game_agents a on a.group_id = v.group_id and a.night = v.night
     where v.voter = p_uid and v.suspect = a.agent and a.revealed_at is not null;
    select count(*) into v_s from public.game_agents a
     where a.agent = p_uid and a.revealed_at is not null and coalesce(a.correct, 0) = 0 and coalesce(a.votes, 0) >= 1;
    select count(*) into v_o from public.game_oracles o where o.user_id = p_uid;
    select count(distinct c.night) into v_b from public.game_bingo_cards c
     where c.bingo_at is not null
       and exists (select 1 from public.game_bingo_ticks t
                    where t.group_id = c.group_id and t.night = c.night and t.user_id = p_uid and t.ticked);
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('uppdrag', v_m), ('uppdrag3', v_m3), ('runda', v_r), ('detektiv', v_d),
    ('spion', v_s), ('orakel', v_o), ('bingo', v_b)
  ) as v(medal, n);
end;
$$;

-- Same name and return type as 0012/0014. Byte-for-byte the same body as in 0018_after.sql, so the
-- order the two files run in does not matter. Unions EVERY public function named
-- olnu_medal_eval / olnu_medal_eval_<x>(uuid) returning (medal text, n int), so later
-- rounds only add an eval function and never need to touch this one again. Counts never go down.
create or replace function public.olnu_medal_store(p_uid uuid)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
begin
  select string_agg(format('select x.medal as m, x.n from public.%I($1) x', p.proname), ' union all ' order by p.proname)
    into v_sql
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname ~ '^olnu_medal_eval(_[a-z0-9]+)?$'
     and pg_get_function_identity_arguments(p.oid) = 'p_uid uuid'
     and pg_get_function_result(p.oid) = 'TABLE(medal text, n integer)';
  if v_sql is null then
    return;
  end if;
  return query execute
    'with ev as (' || v_sql || '),
     e as (select ev.m, max(ev.n)::int as n from ev where ev.n >= 1 group by ev.m),
     up as (
       insert into public.user_medals as um (user_id, medal, count, earned_at, updated_at)
       select $1, e.m, e.n, now(), now() from e
       on conflict on constraint user_medals_pkey do update
          set count = greatest(um.count, excluded.count), updated_at = now()
        where excluded.count > um.count
       returning um.medal, um.count, (um.earned_at = now()) as fresh, um.earned_at)
     select up.medal, up.count, up.fresh, up.earned_at from up'
  using p_uid;
end;
$$;

-- olnu_g_anonymize(old, new): moves every game row of a user to another (random) user id and blanks
-- what could point at a place. For "Radera allt om mig" (0016, the erase RPC): call
--   perform public.olnu_g_anonymize(v_uid, v_new);
-- next to the other anonymizing updates. Catches its own errors (a missing table never blocks the erase).
create or replace function public.olnu_g_anonymize(p_old uuid, p_new uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.game_missions g set user_id = p_new where g.user_id = p_old;
    update public.game_facts g set user_id = p_new where g.user_id = p_old;
    update public.game_sugen g set user_id = p_new, status = 'none' where g.user_id = p_old;
    update public.game_crawls g set user_id = p_new, closed = true where g.user_id = p_old;
    update public.game_agents g set agent = p_new where g.agent = p_old;
    update public.game_agents g set started_by = p_new where g.started_by = p_old;
    update public.game_agent_votes g set voter = p_new where g.voter = p_old;
    update public.game_agent_votes g set suspect = p_new where g.suspect = p_old;
    update public.game_guesses g set user_id = p_new, town = 'Närområdet', lat = 0, lng = 0 where g.user_id = p_old;
    update public.game_oracles g set user_id = p_new where g.user_id = p_old;
    update public.game_bingo_ticks g set user_id = p_new where g.user_id = p_old;
  exception when others then
    null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  fns text[] := array[
    'public.game_poll()',
    'public.game_group(uuid, integer)',
    'public.game_water()',
    'public.game_home()',
    'public.set_sugen(text)',
    'public.create_crawl(uuid, jsonb)',
    'public.close_crawl(bigint)',
    'public.start_agent(uuid)',
    'public.vote_agent(uuid, text)',
    'public.tick_bingo(uuid, integer, boolean)',
    'public.guess_night(integer, text, double precision, double precision)'
  ];
  internal text[] := array[
    'public.olnu_g_prev(timestamptz)',
    'public.olnu_g_key(uuid, uuid)',
    'public.olnu_g_live(uuid, timestamptz, timestamptz)',
    'public.olnu_g_outtonight(uuid, timestamptz)',
    'public.olnu_g_real(timestamptz, double precision, double precision)',
    'public.olnu_g_lines(integer[])',
    'public.olnu_g_member(uuid, uuid)',
    'public.olnu_g_progress(uuid, timestamptz, text, timestamptz)',
    'public.olnu_g_assign(uuid, timestamptz, timestamptz)',
    'public.olnu_g_me(uuid, timestamptz)',
    'public.olnu_g_reveal(uuid, timestamptz, timestamptz)',
    'public.olnu_g_oracle(uuid, timestamptz, timestamptz)',
    'public.olnu_g_group(uuid, uuid, timestamptz, boolean, integer)',
    'public.olnu_g_water(uuid, timestamptz)',
    'public.olnu_g_home(uuid, timestamptz)',
    'public.olnu_g_sugen(uuid, text, timestamptz)',
    'public.olnu_g_crawl(uuid, uuid, jsonb, timestamptz)',
    'public.olnu_g_start_agent(uuid, uuid, timestamptz)',
    'public.olnu_g_vote(uuid, uuid, text, timestamptz)',
    'public.olnu_g_tick(uuid, uuid, integer, boolean, timestamptz)',
    'public.olnu_g_guess(uuid, integer, text, double precision, double precision, timestamptz)',
    'public.olnu_medal_eval_games(uuid)',
    'public.olnu_g_anonymize(uuid, uuid)',
    'public.olnu_medal_store(uuid)'
  ];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
  foreach f in array internal loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;
end $$;
