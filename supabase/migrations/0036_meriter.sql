-- 0036 v26 MERITER (owner decision 2026-10-20): ranks are earned by meriter, points from many actions,
-- not by total beers. Same 36 old rank names + 6 new ones (42 steps, no place names).
-- Identical ladders: SQL olnu_titles() (here), notify-group TITLES, docs/js/social.js TITLES, CONTRACT.md.
--
-- Meriter per action (one table, also in CONTRACT.md "v26 MERITER" and docs/js/meriter.js):
--   kind       pts  cap per night (05-05 Europe/Stockholm)   source (server facts only)
--   squad      10   1 (10)    a drink / check-in within 150 m of a group-mate's pin, check-in or track point tonight
--   checkin     3   1 per bar, 6 bars (18)                    checkins
--   skal_give   1   10                                        skals (giver)
--   skal_get    1   10                                        skals (pin owner)
--   rally_yes   5   3 call-outs (15)                          rally_answers 'yes' on someone else's call-out
--   arrive      5   3 (15)  ETA "framme" for that call-out, or a check-in within 150 m of it, within 2 h
--   callout     5   2 (10)  own call-out with >= 2 answers from others, or a "Kom hit!" push that went out
--   buddy       5   2 (10)  "Jag kollar" on a friend at 10+ (medevac_checks)
--   home        5   1 (5)   "Jag är hemma" (after_nights.home_at / medal_nights.home)
--   status      5   3 (15)  lägesrapport photo in time (status_answers before ends_at)
--   photo       2   5 (10)  chat photo (not a lägesrapport photo)
--   duel_win   15   per duel  member of the winning side who drank in the duel
--   duel        5   per duel  counted member with any duel activity (drink, check-in, skål, photo)
--   game        3   3 (9)   mission done, bingo line you ticked, Dagens orakel
--   drink       1   no cap  every accepted drink (beer or other drink; undo + re-drink never pays twice)
--
-- Design: an append-only ledger (meriter_log) written by AFTER triggers on the existing fact tables, plus a
-- running total (meriter_totals). Every trigger catches its own errors: a meriter bug never blocks a beer,
-- a check-in, a skål or a chat message. Unique (user_id, night, kind, ref) makes every award idempotent;
-- caps are sums of points per (user, night, kind), so backfilled nights and live awards share one cap.
-- The 0016 erase sweep moves the uuid columns of both tables like every other table.
-- Safe to run again. Rows are never removed.

-- ---------------------------------------------------------------------------
-- A. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.meriter_log (
  id         bigserial primary key,
  user_id    uuid not null,
  night      timestamptz not null,
  kind       text not null,
  ref        text not null default '',
  pts        int not null check (pts > 0),
  bf         boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists meriter_log_key on public.meriter_log (user_id, night, kind, ref);
create index if not exists meriter_log_user_id on public.meriter_log (user_id, id);
create index if not exists meriter_log_night on public.meriter_log (night, user_id);

create table if not exists public.meriter_totals (
  user_id    uuid primary key,
  total      int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.meriter_log    enable row level security;
alter table public.meriter_totals enable row level security;
revoke all on public.meriter_log, public.meriter_totals from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.meriter_log, public.meriter_totals from anon, authenticated';
    execute 'revoke all on sequence public.meriter_log_id_seq from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.meriter_log, public.meriter_totals to service_role';
    execute 'grant usage, select on sequence public.meriter_log_id_seq to service_role';
  end if;
end $$;

-- Running total (insert only; the ledger never shrinks).
create or replace function public.olnu_mer_total_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.meriter_totals as t (user_id, total, updated_at)
  values (new.user_id, new.pts, now())
  on conflict (user_id) do update set total = t.total + excluded.total, updated_at = now();
  return null;
end; $$;
create or replace trigger olnu_mer_total after insert on public.meriter_log
  for each row execute function public.olnu_mer_total_tg();

-- ---------------------------------------------------------------------------
-- B. Rank ladder (42 steps, by meriter). Same name and return type as 0007/0012/0035.
-- ---------------------------------------------------------------------------
create or replace function public.olnu_titles()
returns table(at integer, title text)
language sql immutable set search_path = public as $$
  select * from (values
    (0, 'Rekryt'), (5, 'Mönstrad Mellanöl'), (10, 'Menig Mjöd'), (18, 'Vicekorpral Kapsyl'),
    (28, 'Korpral Korkskruv'), (40, 'Skumsergeant'), (52, 'Översergeant Sejdel'), (66, 'Furir Flaskhals'),
    (82, 'Överfurir Fatkran'), (100, 'Fanjunkare Flasköppnare'), (125, 'Fänrik Fatöl'), (150, 'Löjtnant Lager'),
    (180, 'Premiärlöjtnant Pilsner'), (215, 'Kapten Kaggen'), (255, 'Kommendörkapten Krus'), (300, 'Ryttmästare Humle'),
    (350, 'Major Mäsk'), (410, 'Överstelöjtnant Ölstop'), (475, 'Överste Ölkorv'), (550, 'Brigadgeneral Bärs'),
    (630, 'Flottiljamiral Flaskpost'), (720, 'Generalmajor Gambrinus'), (820, 'Generallöjtnant Guldskum'),
    (930, 'General Gyllenbärs'), (1050, 'Amiral Ankarstout'), (1180, 'Fältmarskalk Fradga'),
    (1320, 'Storamiral Skumtopp'), (1470, 'Riksmarskalk Rundtur'), (1640, 'Baron av Bryggstugan'),
    (1830, 'Hertig av Humlefältet'), (2040, 'Ärkehertig av Ölkranen'), (2270, 'Kung Kapsyl den Store'),
    (2520, 'Ölkejsaren'), (2800, 'Bryggerilegenden'), (3100, 'Halvguden vid Jäskaret'), (3450, 'Myten i Mässen'),
    (3850, 'Legenden vid Långbordet'), (4300, 'Sagofiguren i Skyttegraven'), (4800, 'Oraklet i Ölstugan'),
    (5400, 'Överbefälhavare Öl'), (6200, 'Generalissimus Glaset'), (7000, 'Ölguden')
  ) as t(at, title);
$$;

create or replace function public.olnu_meriter(p_uid uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select t.total from public.meriter_totals t where t.user_id = p_uid), 0)::int;
$$;

-- Rank of a meriter value: idx 1..n, title, start, next title / start (null at the top), n = ladder length.
create or replace function public.olnu_rank_of(p_m integer)
returns table(idx integer, title text, at integer, next_title text, next_at integer, n integer)
language sql stable set search_path = public as $$
  with l as (select t.at, t.title, row_number() over (order by t.at)::int as i, count(*) over ()::int as n
               from public.olnu_titles() t),
       c as (select * from l where l.at <= greatest(0, coalesce(p_m, 0)) order by l.at desc limit 1)
  select c.i, c.title, c.at, x.title, x.at, c.n
    from c left join l x on x.i = c.i + 1;
$$;

-- ---------------------------------------------------------------------------
-- C. Award helper. Returns the points written (0 = nothing: capped, already given, or bad input).
-- p_cap = max points per (user, night, kind); null = no cap.
-- ---------------------------------------------------------------------------
create or replace function public.olnu_mer_add(p_uid uuid, p_night timestamptz, p_kind text, p_ref text, p_pts int,
                                               p_cap int default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
  v_pts  int := p_pts;
  v_got  int;
begin
  if p_uid is null or p_night is null or p_kind is null or coalesce(p_pts, 0) <= 0 then
    return 0;
  end if;
  -- One writer per user at a time, so the cap check and the insert agree.
  perform pg_advisory_xact_lock(hashtextextended('olnu-mer:' || p_uid::text, 0));
  if p_cap is not null then
    select coalesce(sum(l.pts), 0)::int into v_used
      from public.meriter_log l where l.user_id = p_uid and l.night = p_night and l.kind = p_kind;
    if v_used >= p_cap then return 0; end if;
    v_pts := least(v_pts, p_cap - v_used);
  end if;
  insert into public.meriter_log (user_id, night, kind, ref, pts)
  values (p_uid, p_night, p_kind, coalesce(p_ref, ''), v_pts)
  on conflict (user_id, night, kind, ref) do nothing
  returning pts into v_got;
  return coalesce(v_got, 0);
end; $$;

-- "Natt med truppen": a group-mate had a pin, a check-in or a track point within 150 m of (lat, lng)
-- tonight. Awards +10 to the caller and to every such mate (once per night each).
create or replace function public.olnu_mer_squad(p_uid uuid, p_night timestamptz, p_lat float8, p_lng float8)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m   uuid;
  v_hit boolean := false;
begin
  if p_uid is null or p_night is null or p_lat is null or p_lng is null or (p_lat = 0 and p_lng = 0) then
    return 0;
  end if;
  for v_m in
    select distinct b.user_id
      from public.group_members a
      join public.group_members b on b.group_id = a.group_id and b.user_id <> a.user_id
     where a.user_id = p_uid
  loop
    if exists (select 1 from public.beers x
                where x.user_id = v_m and x.expires_at = p_night and not coalesce(x.ghost, false)
                  and (x.beer_count + coalesce(x.other_count, 0)) >= 1 and not (x.lat = 0 and x.lng = 0)
                  and abs(x.lat - p_lat) < 0.002 and public.olnu_dist_m(x.lat, x.lng, p_lat, p_lng) <= 150)
       or exists (select 1 from public.checkins c
                   where c.user_id = v_m and c.expires_at = p_night and not (c.lat = 0 and c.lng = 0)
                     and abs(c.lat - p_lat) < 0.002 and public.olnu_dist_m(c.lat, c.lng, p_lat, p_lng) <= 150)
       or exists (select 1 from public.crew_tracks t
                   where t.user_id = v_m and t.night = p_night and t.lat is not null
                     and abs(t.lat - p_lat) < 0.002 and public.olnu_dist_m(t.lat, t.lng, p_lat, p_lng) <= 150) then
      v_hit := true;
      perform public.olnu_mer_add(v_m, p_night, 'squad', '', 10, 10);
    end if;
  end loop;
  if v_hit then
    return public.olnu_mer_add(p_uid, p_night, 'squad', '', 10, 10);
  end if;
  return 0;
end; $$;

-- Duel settled: +15 for each counted member of the winning side who drank, +5 for each counted member
-- with any duel activity (drink, check-in, skål, photo). Same counted-member rule as olnu_duel_side.
create or replace function public.olnu_mer_duel(p_duel bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d     public.duels;
  r     record;
  v_n   int := 0;
  v_win text;
begin
  select * into d from public.duels x where x.id = p_duel;
  if not found or d.winner is null or d.accepted_at is null then return 0; end if;
  for r in
    with sides as (
      select 'a'::text as side, d.group_a as gid, d.group_b as oid
      union all select 'b', d.group_b, d.group_a
    ), mem as (
      select s.side, m.user_id
        from sides s join public.group_members m on m.group_id = s.gid
       where not exists (select 1 from public.group_members o where o.group_id = s.oid and o.user_id = m.user_id)
          or (select ds.side from public.duel_sides ds where ds.duel_id = d.id and ds.user_id = m.user_id) = s.side
    )
    select mem.side, mem.user_id,
           coalesce((select sum(l.n) from public.duel_log l where l.user_id = mem.user_id and l.kind = 'drink'
                      and l.at >= d.accepted_at and l.at <= d.ends_at), 0) as dr,
           exists (select 1 from public.duel_log l where l.user_id = mem.user_id
                    and l.at >= d.accepted_at and l.at <= d.ends_at) as act
      from mem
  loop
    v_win := case when d.winner = r.side then 'w' else '' end;
    if r.act then
      v_n := v_n + public.olnu_mer_add(r.user_id, public.olnu_night_of(d.ends_at - interval '1 second'), 'duel', d.id::text, 5, null);
    end if;
    if v_win = 'w' and r.dr > 0 then
      v_n := v_n + public.olnu_mer_add(r.user_id, public.olnu_night_of(d.ends_at - interval '1 second'), 'duel_win', d.id::text, 15, null);
    end if;
  end loop;
  return v_n;
end; $$;

-- ---------------------------------------------------------------------------
-- D. Triggers (AFTER, never block the write). Names start with olnu_zz_ so they run after the older ones.
-- ---------------------------------------------------------------------------
-- Drinks (+1 each) and squad (position of the pin; ghost pins never count for squad).
create or replace function public.olnu_mer_beers_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old int := 0;
  v_new int;
  i     int;
begin
  begin
    v_new := new.beer_count + coalesce(new.other_count, 0);
    if tg_op = 'UPDATE' and old.expires_at = new.expires_at then
      v_old := old.beer_count + coalesce(old.other_count, 0);
    end if;
    if v_new > v_old and new.expires_at > now() then
      for i in (v_old + 1)..least(v_new, v_old + 20) loop
        perform public.olnu_mer_add(new.user_id, new.expires_at, 'drink', 'd' || i::text, 1, null);
      end loop;
      if not coalesce(new.ghost, false) and not coalesce(new.stopped, false) then
        perform public.olnu_mer_squad(new.user_id, new.expires_at, new.lat, new.lng);
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_beers after insert or update on public.beers
  for each row execute function public.olnu_mer_beers_tg();

-- Check-in: +3 per bar (6 bars), squad, and "arrived" for a call-out answered yes in the last 2 h nearby.
create or replace function public.olnu_mer_checkins_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    if tg_op = 'UPDATE' and old.created_at = new.created_at and old.bar_id = new.bar_id then
      return null;
    end if;
    if new.expires_at <= now() or (new.lat = 0 and new.lng = 0) then return null; end if;
    perform public.olnu_mer_add(new.user_id, new.expires_at, 'checkin', 'ci:' || new.bar_id, 3, 18);
    perform public.olnu_mer_squad(new.user_id, new.expires_at, new.lat, new.lng);
    for r in
      select ra.rally_id from public.rally_answers ra join public.rallies x on x.id = ra.rally_id
       where ra.user_id = new.user_id and ra.answer = 'yes' and x.user_id <> new.user_id
         and x.lat is not null and x.created_at > now() - interval '2 hours'
         and public.olnu_dist_m(x.lat, x.lng, new.lat, new.lng) <= 150
    loop
      perform public.olnu_mer_add(new.user_id, new.expires_at, 'arrive', r.rally_id::text, 5, 15);
    end loop;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_checkins after insert or update on public.checkins
  for each row execute function public.olnu_mer_checkins_tg();

-- Skål: +1 for the giver (10/night), +1 for the pin owner (10/night).
create or replace function public.olnu_mer_skals_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  begin
    select x.user_id, x.expires_at into b from public.beers x where x.id = new.beer_id;
    if found and b.user_id <> new.user_id then
      perform public.olnu_mer_add(new.user_id, b.expires_at, 'skal_give', 'b:' || new.beer_id::text, 1, 10);
      perform public.olnu_mer_add(b.user_id, b.expires_at, 'skal_get', 'u:' || new.user_id::text || ':' || new.beer_id::text, 1, 10);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_skals after insert on public.skals
  for each row execute function public.olnu_mer_skals_tg();

-- Call-out answers: +5 for a yes on someone else's call-out (3/night); the creator gets +5 when the
-- call-out has answers from 2 or more others (callout, 2/night together with "Kom hit!").
create or replace function public.olnu_mer_rally_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
  v_n int;
begin
  begin
    select r.id, r.user_id, r.created_at into x from public.rallies r where r.id = new.rally_id;
    if not found or x.user_id = new.user_id then return null; end if;
    if new.answer = 'yes' then
      perform public.olnu_mer_add(new.user_id, public.olnu_night_of(x.created_at), 'rally_yes', x.id::text, 5, 15);
    end if;
    select count(*) into v_n from public.rally_answers a where a.rally_id = x.id and a.user_id <> x.user_id;
    if v_n >= 2 then
      perform public.olnu_mer_add(x.user_id, public.olnu_night_of(x.created_at), 'callout', 'r:' || x.id::text, 5, 10);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_rally after insert or update on public.rally_answers
  for each row execute function public.olnu_mer_rally_tg();

-- ETA "framme" for a call-out the user said yes to, within 2 h of the call-out: +5 (arrive).
create or replace function public.olnu_mer_etas_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
begin
  begin
    if new.arrived_at is null or (tg_op = 'UPDATE' and old.arrived_at is not null) or new.rally_id is null then
      return null;
    end if;
    select r.id, r.user_id, r.created_at into x from public.rallies r where r.id = new.rally_id;
    if not found or x.user_id = new.user_id or new.arrived_at > x.created_at + interval '2 hours' then return null; end if;
    if exists (select 1 from public.rally_answers a where a.rally_id = x.id and a.user_id = new.user_id and a.answer = 'yes') then
      perform public.olnu_mer_add(new.user_id, public.olnu_night_of(x.created_at), 'arrive', x.id::text, 5, 15);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_etas after insert or update on public.etas
  for each row execute function public.olnu_mer_etas_tg();

-- "Kom hit!" that went out (notify-group writes push_sent kind 'comehere'): +5 callout, once per night.
create or replace function public.olnu_mer_push_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.kind = 'comehere' then
      perform public.olnu_mer_add(new.user_id, public.olnu_night_of(coalesce(new.sent_at, now())), 'callout', 'k', 5, 10);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_push after insert on public.push_sent
  for each row execute function public.olnu_mer_push_tg();

-- "Jag kollar" on a friend at 10+: +5 (2/night).
create or replace function public.olnu_mer_medevac_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.olnu_mer_add(new.checker, new.night, 'buddy', new.target::text, 5, 10);
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_medevac after insert on public.medevac_checks
  for each row execute function public.olnu_mer_medevac_tg();

-- "Jag är hemma": +5 once per night (after_nights.home_at from mark_home, medal_nights.home from award_medals).
create or replace function public.olnu_mer_home_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_table_name = 'after_nights' then
      if new.home_at is not null and (tg_op = 'INSERT' or old.home_at is null) then
        perform public.olnu_mer_add(new.user_id, new.night, 'home', '', 5, 5);
      end if;
    elsif coalesce(new.home, false) and (tg_op = 'INSERT' or not coalesce(old.home, false)) then
      perform public.olnu_mer_add(new.user_id, new.night, 'home', '', 5, 5);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_home after insert or update on public.after_nights
  for each row execute function public.olnu_mer_home_tg();
create or replace trigger olnu_zz_mer_home after insert or update on public.medal_nights
  for each row execute function public.olnu_mer_home_tg();

-- Lägesrapport answered in time: +5 (3/night).
create or replace function public.olnu_mer_status_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  q record;
begin
  begin
    select r.id, r.created_at, r.ends_at into q from public.status_reqs r where r.id = new.req_id;
    if found and new.created_at <= q.ends_at then
      perform public.olnu_mer_add(new.user_id, public.olnu_night_of(q.created_at), 'status', q.id::text, 5, 15);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_status after insert on public.status_answers
  for each row execute function public.olnu_mer_status_tg();

-- Chat photo: +2 (5/night). A lägesrapport photo (chat body "📷 🎖️ Lägesrapport…") pays as status instead.
create or replace function public.olnu_mer_photo_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.msg_id is not null and exists (select 1 from public.group_msgs m where m.id = new.msg_id
                                            and m.body like '📷 🎖️ Lägesrapport%') then
      return null;
    end if;
    perform public.olnu_mer_add(new.user_id, public.olnu_night_of(new.created_at), 'photo', new.id::text, 2, 10);
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_photo after insert on public.chat_photos
  for each row execute function public.olnu_mer_photo_tg();

-- Duel settled (winner set by olnu_duel_finish).
create or replace function public.olnu_mer_duels_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.winner is not null and old.winner is null then
      perform public.olnu_mer_duel(new.id);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_duels after update on public.duels
  for each row execute function public.olnu_mer_duels_tg();

-- Lek: mission done, a bingo line in your group (you ticked), Dagens orakel: +3 each (3/night).
create or replace function public.olnu_mer_games_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_u uuid;
begin
  begin
    if tg_table_name = 'game_missions' then
      if new.done_at is not null and (tg_op = 'INSERT' or old.done_at is null) then
        perform public.olnu_mer_add(new.user_id, new.night, 'game', 'm' || new.slot::text, 3, 9);
      end if;
    elsif tg_table_name = 'game_bingo_cards' then
      if new.bingo_at is not null and (tg_op = 'INSERT' or old.bingo_at is null) then
        for v_u in select distinct t.user_id from public.game_bingo_ticks t
                    where t.group_id = new.group_id and t.night = new.night and t.ticked loop
          perform public.olnu_mer_add(v_u, new.night, 'game', 'b:' || new.group_id::text, 3, 9);
        end loop;
      end if;
    elsif tg_table_name = 'game_oracles' then
      perform public.olnu_mer_add(new.user_id, new.night, 'game', 'o:' || new.group_id::text, 3, 9);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_games after insert or update on public.game_missions
  for each row execute function public.olnu_mer_games_tg();
create or replace trigger olnu_zz_mer_games after insert or update on public.game_bingo_cards
  for each row execute function public.olnu_mer_games_tg();
create or replace trigger olnu_zz_mer_games after insert on public.game_oracles
  for each row execute function public.olnu_mer_games_tg();

-- ---------------------------------------------------------------------------
-- E. RPCs
-- ---------------------------------------------------------------------------
-- my_stats: same fields as v7 (total = lifetime drinks, week), title / next_title / next_at now by MERITER,
-- plus new fields at the end: meriter, rank (1..n), ranks (n), rank_at, tonight_meriter.
-- poll_v2.me = my_stats() || …, so the poll carries them too.
create or replace function public.my_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_total int := public.olnu_lifetime(v_uid);
  v_m int := public.olnu_meriter(v_uid);
  v_week int;
  v_tn int;
  r record;
begin
  select coalesce(sum(w.n), 0)::int into v_week from public.week_beers w where w.user_id = v_uid and w.week = public.olnu_week_start(now());
  select coalesce(sum(l.pts), 0)::int into v_tn from public.meriter_log l
   where l.user_id = v_uid and l.night = public.olnu_night_of(now());
  select * into r from public.olnu_rank_of(v_m);
  return json_build_object('total', v_total, 'week', v_week, 'title', r.title, 'next_title', r.next_title, 'next_at', r.next_at,
                           'meriter', v_m, 'rank', r.idx, 'ranks', r.n, 'rank_at', r.at, 'tonight_meriter', v_tn);
end; $$;

-- my_meriter(p_after_id): totals + the caller's live ledger rows with id > p_after_id (newest 40, oldest first).
-- p_after_id = 0 → no events, only last_id (first open: nothing old pops up). Backfill rows never show.
create or replace function public.my_meriter(p_after_id bigint default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_m    int;
  v_last bigint;
  v_tn   int;
  v_wk   int;
  v_ev   jsonb := '[]'::jsonb;
  v_wstart timestamptz := ((public.olnu_week_start(now()) + interval '29 hours') at time zone 'Europe/Stockholm');
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_m := public.olnu_meriter(v_uid);
  select coalesce(max(l.id), 0) into v_last from public.meriter_log l where l.user_id = v_uid;
  select coalesce(sum(l.pts) filter (where l.night = public.olnu_night_of(now())), 0)::int,
         coalesce(sum(l.pts) filter (where l.night >= v_wstart), 0)::int
    into v_tn, v_wk
    from public.meriter_log l where l.user_id = v_uid and l.night >= least(v_wstart, public.olnu_night_of(now()));
  if coalesce(p_after_id, 0) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'pts', e.pts, 'at', e.created_at) order by e.id), '[]'::jsonb)
      into v_ev
      from (select l.id, l.kind, l.pts, l.created_at from public.meriter_log l
             where l.user_id = v_uid and l.id > p_after_id and not l.bf
             order by l.id desc limit 40) e;
  end if;
  select * into r from public.olnu_rank_of(v_m);
  return jsonb_build_object('meriter', v_m, 'title', r.title, 'rank', r.idx, 'ranks', r.n, 'rank_at', r.at,
                            'next_title', r.next_title, 'next_at', r.next_at, 'tonight', v_tn, 'week', v_wk,
                            'last_id', v_last, 'events', v_ev);
end; $$;

-- group_status_v3 = group_status_v2 columns + meriter (total) + rank (1..n). Members only.
create or replace function public.group_status_v3(p_group_id uuid)
returns table(name text, beers integer, others integer, other_kind text, live boolean, total integer, is_me boolean,
              k text, is_owner boolean, is_chief boolean, is_vice boolean, is_acting boolean, home_town text,
              can_remove boolean, joined_at timestamptz, meriter integer, rank integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.name, s.beers, s.others, s.other_kind, s.live, s.total, s.is_me, s.k, s.is_owner, s.is_chief, s.is_vice,
         s.is_acting, s.home_town, s.can_remove, s.joined_at,
         public.olnu_meriter(gm.user_id), (select r.idx from public.olnu_rank_of(public.olnu_meriter(gm.user_id)) r)
    from public.group_status_v2(p_group_id) s
    left join public.group_members gm on gm.group_id = p_group_id and public.olnu_chief_k(p_group_id, gm.user_id) = s.k
   order by s.beers desc, s.others desc, s.name;
$$;

-- Meriter board. p_scope 'group' (p_group_id, members only, display names) or 'town' (users whose night
-- place or live pin / check-in was within p_km of the point in the last 30 days; names only for users who
-- switched the board on, same rule as local_board). p_period 'tonight' | 'week' | 'all'. Top 20 + the caller.
create or replace function public.meriter_board(p_scope text default 'group', p_group_id uuid default null,
                                                p_lat float8 default null, p_lng float8 default null,
                                                p_period text default 'week', p_km float8 default 20)
returns table(rank integer, name text, meriter integer, title text, is_me boolean, home_town text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid    uuid := public.olnu_uid();
  v_scope  text := lower(btrim(coalesce(p_scope, 'group')));
  v_period text := lower(btrim(coalesce(p_period, 'week')));
  v_km     float8 := least(50, greatest(5, coalesce(nullif(p_km, 'NaN'::float8), 20)));
  v_lat    float8;
  v_lng    float8;
  v_dlat   float8;
  v_night  timestamptz := public.olnu_night_of(now());
  v_wstart timestamptz := ((public.olnu_week_start(now()) + interval '29 hours') at time zone 'Europe/Stockholm');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_period not in ('tonight', 'week', 'all') then raise exception 'invalid_period'; end if;
  if v_scope not in ('group', 'town') then raise exception 'invalid_scope'; end if;
  perform public.olnu_board_rl(v_uid);
  if v_scope = 'group' then
    if p_group_id is null or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    return query
    with u as (
      select gm.user_id, gm.display_name as nm from public.group_members gm where gm.group_id = p_group_id
    ), v as (
      select u.user_id, u.nm,
             case when v_period = 'all' then public.olnu_meriter(u.user_id)
                  else coalesce((select sum(l.pts) from public.meriter_log l where l.user_id = u.user_id
                                  and l.night >= case when v_period = 'tonight' then v_night else v_wstart end), 0)::int end as m
        from u
    ), rk as (
      select v.*, rank() over (order by v.m desc)::int as rn, row_number() over (order by v.m desc, v.nm) as o from v
    )
    select rk.rn, rk.nm, rk.m, (select r.title from public.olnu_rank_of(public.olnu_meriter(rk.user_id)) r),
           rk.user_id = v_uid, public.olnu_home_town(rk.user_id)
      from rk where rk.o <= 20 or rk.user_id = v_uid order by rk.o;
    return;
  end if;
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_lat := round(p_lat::numeric, 2)::float8;  v_lng := round(p_lng::numeric, 2)::float8;
  v_dlat := v_km / 111.0;
  return query
  with near as (
    select distinct n.user_id from public.board_nights n
     where n.night > now() - interval '30 days' and n.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(n.lat, n.lng, v_lat, v_lng) <= v_km * 1000
    union
    select b.user_id from public.beers b
     where b.expires_at > now() and not coalesce(b.ghost, false) and b.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(b.lat, b.lng, v_lat, v_lng) <= v_km * 1000
    union
    select c.user_id from public.checkins c
     where c.expires_at > now() and c.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(c.lat, c.lng, v_lat, v_lng) <= v_km * 1000
    union
    select v_uid
  ), v as (
    select near.user_id,
           case when v_period = 'all' then public.olnu_meriter(near.user_id)
                else coalesce((select sum(l.pts) from public.meriter_log l where l.user_id = near.user_id
                                and l.night >= case when v_period = 'tonight' then v_night else v_wstart end), 0)::int end as m
      from near
  ), rk as (
    select v.*, rank() over (order by v.m desc)::int as rn, row_number() over (order by v.m desc, v.user_id) as o
      from v where v.m > 0 or v.user_id = v_uid
  )
  select rk.rn, public.olnu_board_name(rk.user_id), rk.m,
         (select r.title from public.olnu_rank_of(public.olnu_meriter(rk.user_id)) r),
         rk.user_id = v_uid,
         case when public.olnu_board_name(rk.user_id) is not null then public.olnu_home_town(rk.user_id) end
    from rk where rk.o <= 20 or rk.user_id = v_uid order by rk.o;
end; $$;

-- ---------------------------------------------------------------------------
-- F. Grants: RPCs authenticated only; helpers and triggers not callable by clients.
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.olnu_titles()', 'public.olnu_meriter(uuid)', 'public.olnu_rank_of(integer)',
    'public.olnu_mer_add(uuid, timestamptz, text, text, integer, integer)',
    'public.olnu_mer_squad(uuid, timestamptz, float8, float8)', 'public.olnu_mer_duel(bigint)',
    'public.olnu_mer_total_tg()', 'public.olnu_mer_beers_tg()', 'public.olnu_mer_checkins_tg()', 'public.olnu_mer_skals_tg()',
    'public.olnu_mer_rally_tg()', 'public.olnu_mer_etas_tg()', 'public.olnu_mer_push_tg()', 'public.olnu_mer_medevac_tg()',
    'public.olnu_mer_home_tg()', 'public.olnu_mer_status_tg()', 'public.olnu_mer_photo_tg()', 'public.olnu_mer_duels_tg()',
    'public.olnu_mer_games_tg()'
  ] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function ' || f || ' from anon, authenticated';
    end if;
  end loop;
  foreach f in array array[
    'public.my_stats()', 'public.my_meriter(bigint)', 'public.group_status_v3(uuid)',
    'public.meriter_board(text, uuid, float8, float8, text, float8)'
  ] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function ' || f || ' from anon';
      execute 'grant execute on function ' || f || ' to authenticated';
    end if;
  end loop;
end $$;
