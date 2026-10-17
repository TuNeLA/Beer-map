-- Öl Nu v11: MEDALS & RANKS. Additive. Safe to run again.
-- 1. New rank ladder (36 steps, dense at the start). Same function name and return type as before (olnu_titles),
--    so my_stats / old clients keep working. Same list in notify-group TITLES and docs/js/social.js.
-- 2. Medals stored on the server so group-mates can see them (user_medals).
--    Facts are logged by small triggers (medal_nights, medal_checkins, medal_counts) because the
--    beers / checkins / skals rows only live for one night. award_medals() evaluates the rules from
--    server data and stores the result. claim_medal() lets the client report a few low-stakes,
--    local-only medals (whitelist). No medal rewards drinking fast or many beers in a short time.
-- This file has no remove-type statements on purpose (create-or-replace, "if not exists",
-- "on conflict" only). Every trigger body catches its own errors, so a medal bug can never
-- block a beer, a check-in, a skål or a chat message.
-- Needs 0001-0011 first. Postgres 14+ (create or replace trigger).

-- ---------------------------------------------------------------------------
-- 1. Rank ladder
-- ---------------------------------------------------------------------------
create or replace function public.olnu_titles()
returns table (at int, title text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    (0, 'Rekryt'), (3, 'Mönstrad Mellanöl'), (5, 'Menig Mjöd'), (7, 'Vicekorpral Kapsyl'),
    (10, 'Kapsylkorpral från Grangärde'), (13, 'Skumsergeant'), (17, 'Furir Flaskhals'),
    (22, 'Överfurir Fatkran'), (28, 'Fanjunkare Flasköppnare'), (35, 'Fänrik Fatöl'),
    (43, 'Löjtnant Lager'), (52, 'Premiärlöjtnant Pilsner'), (62, 'Kapten Kaggen'),
    (75, 'Ryttmästare Humle'), (90, 'Major Malt från Smedjebacken'), (110, 'Överstelöjtnant Ölstop'),
    (130, 'Överste Ölkorv'), (155, 'Brigadgeneral Bärs'), (180, 'Generalmajor Gambrinus'),
    (210, 'Generallöjtnant Guldskum'), (245, 'General Dalabärs'), (285, 'Fältmarskalk Fradga'),
    (330, 'Riksmarskalk Rundtur'), (380, 'Baron av Bryggstugan'), (430, 'Hertig av Humlegården'),
    (490, 'Ärkehertig av Ölkranen'), (560, 'Kung Kapsyl av Dalarna'), (640, 'Ölkejsaren'),
    (730, 'Bryggerilegenden'), (830, 'Halvguden från Väsman'), (920, 'Myten från Grängesberg'),
    (1000, 'Legenden från Ludvika'), (1100, 'Sagofiguren från Säfsnäs'), (1200, 'Oraklet i Ölstugan'),
    (1300, 'Överbefälhavare Öl'), (1500, 'Ölguden')
  ) as t(at, title);
$$;
revoke all on function public.olnu_titles() from public;

-- ---------------------------------------------------------------------------
-- 2. Tables (RLS on, no policies; only SECURITY DEFINER functions and the service role use them)
-- ---------------------------------------------------------------------------

-- Earned medals. count = how many times (stacking medals show "x3"). Never taken back.
create table if not exists public.user_medals (
  user_id    uuid not null,
  medal      text not null check (char_length(medal) between 1 and 40),
  earned_at  timestamptz not null default now(),
  count      int  not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, medal)
);
create index if not exists user_medals_user_idx on public.user_medals (user_id, earned_at);

-- One row per user per night (night = the 05:00 expiry). cell = a coarse region (~50 km),
-- never a precise place.
create table if not exists public.medal_nights (
  user_id  uuid not null,
  night    timestamptz not null,
  beers    int not null default 0,
  others   int not null default 0,
  first_at timestamptz,
  early    boolean not null default false,
  owl      boolean not null default false,
  home     boolean not null default false,
  cell     text,
  primary key (user_id, night)
);
create index if not exists medal_nights_night_idx on public.medal_nights (night);

-- Bars visited (check-ins and "Kung av baren" taps), per night.
create table if not exists public.medal_checkins (
  user_id uuid not null,
  bar_id  text not null,
  night   timestamptz not null,
  primary key (user_id, bar_id, night)
);

-- Lifetime counters.
create table if not exists public.medal_counts (
  user_id    uuid primary key,
  skal_given int not null default 0,
  skal_got   int not null default 0,
  msgs       int not null default 0
);

-- Client-reported low-stakes medals (whitelist in claim_medal), one per medal per night.
create table if not exists public.medal_claims (
  user_id uuid not null,
  medal   text not null,
  night   timestamptz not null,
  primary key (user_id, medal, night)
);

alter table public.user_medals    enable row level security;
alter table public.medal_nights   enable row level security;
alter table public.medal_checkins enable row level security;
alter table public.medal_counts   enable row level security;
alter table public.medal_claims   enable row level security;

revoke all on table public.user_medals, public.medal_nights, public.medal_checkins,
  public.medal_counts, public.medal_claims from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.user_medals, public.medal_nights, public.medal_checkins, public.medal_counts, public.medal_claims from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.user_medals, public.medal_nights, public.medal_checkins, public.medal_counts, public.medal_claims from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.user_medals, public.medal_nights, public.medal_checkins, public.medal_counts, public.medal_claims to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Helpers (internal)
-- ---------------------------------------------------------------------------

-- The night (next 05:00 Europe/Stockholm strictly after p).
create or replace function public.olnu_night_of(p timestamptz)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when (p at time zone 'Europe/Stockholm') >= date_trunc('day', p at time zone 'Europe/Stockholm') + interval '5 hours'
      then (date_trunc('day', p at time zone 'Europe/Stockholm') + interval '29 hours') at time zone 'Europe/Stockholm'
    else (date_trunc('day', p at time zone 'Europe/Stockholm') + interval '5 hours') at time zone 'Europe/Stockholm'
  end;
$$;

-- Evening date of a night (the day the night started).
create or replace function public.olnu_evening(p_night timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select ((p_night at time zone 'Europe/Stockholm') - interval '6 hours')::date;
$$;

-- Coarse region cell (~55 km x ~55 km): no precise place is ever stored here.
create or replace function public.olnu_cell(p_lat float8, p_lng float8)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_lat is null or p_lng is null then null
    else ((round(p_lat::numeric * 2) / 2)::numeric(6, 1))::text || ':' || (round(p_lng::numeric)::int)::text end;
$$;

revoke all on function public.olnu_night_of(timestamptz), public.olnu_evening(timestamptz),
  public.olnu_cell(float8, float8) from public;

-- ---------------------------------------------------------------------------
-- 4. Fact triggers (each catches its own errors)
-- ---------------------------------------------------------------------------

-- beers: tonight's beer / other-drink counts, first beer time, day/late hour flags, coarse cell.
create or replace function public.olnu_medal_beers_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ob int := 0;
  v_oo int := 0;
  v_h  int := extract(hour from (now() at time zone 'Europe/Stockholm'))::int;
begin
  begin
    if tg_op = 'UPDATE' then
      v_ob := coalesce(old.beer_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if coalesce(new.beer_count, 0) > v_ob then
      insert into public.medal_nights as m (user_id, night, beers, first_at, early, owl, cell)
      values (new.user_id, new.expires_at, new.beer_count, now(),
              v_h >= 5 and v_h < 16, v_h >= 1 and v_h < 5, public.olnu_cell(new.lat, new.lng))
      on conflict (user_id, night) do update
         set beers = greatest(m.beers, excluded.beers),
             first_at = coalesce(m.first_at, excluded.first_at),
             early = m.early or excluded.early,
             owl = m.owl or excluded.owl,
             cell = coalesce(m.cell, excluded.cell);
    end if;
    if coalesce(new.other_count, 0) > v_oo then
      insert into public.medal_nights as m (user_id, night, others)
      values (new.user_id, new.expires_at, new.other_count)
      on conflict (user_id, night) do update set others = greatest(m.others, excluded.others);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_medal_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_medal_beers_tg();

-- checkins (v10) and bar_taps (Kung av baren): bars visited per night.
create or replace function public.olnu_medal_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.medal_checkins (user_id, bar_id, night)
    values (new.user_id, left(new.bar_id, 80), public.olnu_night_of(now()))
    on conflict do nothing;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_medal_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_medal_checkin_tg();
create or replace trigger olnu_medal_bar_taps
  after insert or update on public.bar_taps
  for each row execute function public.olnu_medal_checkin_tg();

-- skals: given (caller) and received (beer owner).
create or replace function public.olnu_medal_skal_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  begin
    insert into public.medal_counts as c (user_id, skal_given) values (new.user_id, 1)
    on conflict (user_id) do update set skal_given = c.skal_given + 1;
    select b.user_id into v_owner from public.beers b where b.id = new.beer_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.medal_counts as c (user_id, skal_got) values (v_owner, 1)
      on conflict (user_id) do update set skal_got = c.skal_got + 1;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_medal_skals
  after insert on public.skals
  for each row execute function public.olnu_medal_skal_tg();

-- group_msgs: chat messages sent.
create or replace function public.olnu_medal_msg_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.medal_counts as c (user_id, msgs) values (new.user_id, 1)
    on conflict (user_id) do update set msgs = c.msgs + 1;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_medal_msgs
  after insert on public.group_msgs
  for each row execute function public.olnu_medal_msg_tg();

revoke all on function public.olnu_medal_beers_tg(), public.olnu_medal_checkin_tg(),
  public.olnu_medal_skal_tg(), public.olnu_medal_msg_tg() from public;

-- ---------------------------------------------------------------------------
-- 5. Backfill from what the server still has (only fills empty rows; safe to re-run)
-- ---------------------------------------------------------------------------
insert into public.medal_nights (user_id, night, beers, others, first_at, cell)
select b.user_id, b.expires_at, b.beer_count, coalesce(b.other_count, 0),
       case when b.beer_count > 0 then b.created_at end, public.olnu_cell(b.lat, b.lng)
  from public.beers b
 where b.beer_count > 0 or coalesce(b.other_count, 0) > 0
on conflict do nothing;

insert into public.medal_checkins (user_id, bar_id, night)
select t.user_id, left(t.bar_id, 80), public.olnu_night_of(t.last_at) from public.bar_taps t
on conflict do nothing;
insert into public.medal_checkins (user_id, bar_id, night)
select c.user_id, c.bar_id, c.expires_at from public.checkins c
on conflict do nothing;

insert into public.medal_counts (user_id, skal_given, skal_got, msgs)
select u.uid, coalesce(g.n, 0), coalesce(r.n, 0), coalesce(m.n, 0)
  from (select user_id as uid from public.skals
        union select b.user_id from public.skals s join public.beers b on b.id = s.beer_id
        union select user_id from public.group_msgs) u
  left join (select user_id, count(*)::int n from public.skals group by user_id) g on g.user_id = u.uid
  left join (select b.user_id, count(*)::int n from public.skals s join public.beers b on b.id = s.beer_id
              where s.user_id <> b.user_id group by b.user_id) r on r.user_id = u.uid
  left join (select user_id, count(*)::int n from public.group_msgs group by user_id) m on m.user_id = u.uid
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Rules: olnu_medal_eval(uid) -> (medal, n). n >= 1 = earned; n = stack count.
--    Medal ids (stable; the client has names and texts):
--    milestones: m1 m10 m50 m100 m250 m500 m1000      nights: n5 n25 n100
--    bars: b5 b15 b40, krogrunda, stammis            skål: sg10 sg100 sr10 sr100
--    rally: inryckt alltid trumslag                  home: hemvarn komhem
--    day/hours: dagsljus uggla tisdag                group: fortrupp kung liga pluton kompani
--    chat: radio signal                              holidays: valborg midsommar lucia nyar
--    travel: faltresa                                other: sidospar spoke vatten
--    "Varit med om" (hidden until earned, caring text, never a goal): het medevac
-- ---------------------------------------------------------------------------
create or replace function public.olnu_medal_eval(p_uid uuid)
returns table (medal text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total int := public.olnu_lifetime(p_uid);
  v_nights int; v_bars int; v_rounds int; v_regular int;
  v_sg int := 0; v_sr int := 0; v_msgs int := 0;
  v_yes int; v_rallies int; v_home int; v_day int; v_owl int; v_tue int;
  v_first int; v_king int; v_league int; v_cells int; v_side int; v_hot int; v_med int;
  v_valb int; v_mids int; v_luc int; v_nyar int; v_group int; v_comp int;
  v_week date := public.olnu_week_start(now());
begin
  select count(*) filter (where mn.beers >= 1),
         count(*) filter (where mn.beers >= 1 and mn.home),
         count(*) filter (where mn.beers >= 1 and mn.early),
         count(*) filter (where mn.beers >= 1 and mn.owl),
         count(*) filter (where mn.beers >= 1 and extract(isodow from public.olnu_evening(mn.night)) = 2),
         count(*) filter (where mn.others >= 1),
         count(*) filter (where mn.beers >= 5),
         count(*) filter (where mn.beers >= 10),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where mn.beers >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '04-30'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where mn.beers >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') between '06-19' and '06-25'
                   and extract(isodow from public.olnu_evening(mn.night)) = 5),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where mn.beers >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-13'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where mn.beers >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-31'),
         count(distinct mn.cell) filter (where mn.beers >= 1)
    into v_nights, v_home, v_day, v_owl, v_tue, v_side, v_hot, v_med, v_valb, v_mids, v_luc, v_nyar, v_cells
    from public.medal_nights mn where mn.user_id = p_uid;

  select count(distinct c.bar_id) into v_bars from public.medal_checkins c where c.user_id = p_uid;
  select count(*) into v_rounds from (
    select c.night from public.medal_checkins c where c.user_id = p_uid group by c.night having count(*) >= 3) x;
  select count(*) into v_regular from (
    select c.bar_id from public.medal_checkins c where c.user_id = p_uid group by c.bar_id having count(*) >= 5) x;

  select coalesce(mc.skal_given, 0), coalesce(mc.skal_got, 0), coalesce(mc.msgs, 0)
    into v_sg, v_sr, v_msgs from public.medal_counts mc where mc.user_id = p_uid;
  v_sg := coalesce(v_sg, 0); v_sr := coalesce(v_sr, 0); v_msgs := coalesce(v_msgs, 0);

  select count(*) into v_yes from public.rally_answers a join public.rallies r on r.id = a.rally_id
   where a.user_id = p_uid and a.answer = 'yes' and r.user_id <> p_uid;
  select count(*) into v_rallies from public.rallies r where r.user_id = p_uid;

  -- Förtruppen: first of the group out on a night where at least one group-mate was out too.
  select count(*) into v_first
    from public.medal_nights mn
   where mn.user_id = p_uid and mn.beers >= 1 and mn.first_at is not null
     and exists (select 1 from public.medal_nights o
                  where o.night = mn.night and o.beers >= 1 and o.user_id <> p_uid
                    and o.user_id in (select am.user_id from public.group_members am
                                        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid))
     and not exists (select 1 from public.medal_nights o
                      where o.night = mn.night and o.beers >= 1 and o.user_id <> p_uid and o.first_at < mn.first_at
                        and o.user_id in (select am.user_id from public.group_members am
                                            join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid));

  -- Barkung: king of a bar in a week (same rule as bar_kings).
  select count(*) into v_king from (
    select t.user_id, row_number() over (partition by t.bar_id, t.week order by t.n desc, t.last_at asc, t.user_id) as rn
      from public.bar_taps t
     where t.n > 0 and t.bar_id in (select x.bar_id from public.bar_taps x where x.user_id = p_uid)
  ) k where k.rn = 1 and k.user_id = p_uid;

  -- Ligamästare: one of my groups was number 1 in a finished week (last 26 weeks, current members).
  select count(*) into v_league from (
    select distinct on (s.wk) s.wk, s.gid
      from (select wb.week as wk, gm.group_id as gid, sum(wb.n) as tot, g.created_at as gat
              from public.week_beers wb
              join public.group_members gm on gm.user_id = wb.user_id
              join public.groups g on g.id = gm.group_id
             where wb.week < v_week and wb.week >= v_week - 182
               and gm.group_id in (select x.group_id from public.group_members x group by x.group_id having count(*) >= 2)
             group by wb.week, gm.group_id, g.created_at) s
     where s.tot > 0
     order by s.wk, s.tot desc, s.gat asc, s.gid
  ) top
   where top.gid in (select m.group_id from public.group_members m where m.user_id = p_uid);

  select count(*) into v_group from public.group_members m where m.user_id = p_uid;
  select count(*) into v_comp from public.groups g
   where g.created_by = p_uid
     and (select count(*) from public.group_members m where m.group_id = g.id) >= 5;

  return query
  select v.medal, v.n from (values
    ('m1', case when v_total >= 1 then 1 else 0 end),
    ('m10', case when v_total >= 10 then 1 else 0 end),
    ('m50', case when v_total >= 50 then 1 else 0 end),
    ('m100', case when v_total >= 100 then 1 else 0 end),
    ('m250', case when v_total >= 250 then 1 else 0 end),
    ('m500', case when v_total >= 500 then 1 else 0 end),
    ('m1000', case when v_total >= 1000 then 1 else 0 end),
    ('n5', case when v_nights >= 5 then 1 else 0 end),
    ('n25', case when v_nights >= 25 then 1 else 0 end),
    ('n100', case when v_nights >= 100 then 1 else 0 end),
    ('b5', case when v_bars >= 5 then 1 else 0 end),
    ('b15', case when v_bars >= 15 then 1 else 0 end),
    ('b40', case when v_bars >= 40 then 1 else 0 end),
    ('krogrunda', v_rounds),
    ('stammis', v_regular),
    ('sg10', case when v_sg >= 10 then 1 else 0 end),
    ('sg100', case when v_sg >= 100 then 1 else 0 end),
    ('sr10', case when v_sr >= 10 then 1 else 0 end),
    ('sr100', case when v_sr >= 100 then 1 else 0 end),
    ('inryckt', case when v_yes >= 1 then 1 else 0 end),
    ('alltid', case when v_yes >= 10 then 1 else 0 end),
    ('trumslag', case when v_rallies >= 1 then 1 else 0 end),
    ('hemvarn', v_home),
    ('komhem', case when v_home >= 5 then v_home / 5 else 0 end),
    ('dagsljus', v_day),
    ('uggla', v_owl),
    ('tisdag', v_tue),
    ('fortrupp', v_first),
    ('kung', v_king),
    ('liga', v_league),
    ('pluton', case when v_group >= 1 then 1 else 0 end),
    ('kompani', v_comp),
    ('radio', case when v_msgs >= 1 then 1 else 0 end),
    ('signal', case when v_msgs >= 50 then 1 else 0 end),
    ('valborg', v_valb),
    ('midsommar', v_mids),
    ('lucia', v_luc),
    ('nyar', v_nyar),
    ('faltresa', greatest(0, v_cells - 1)),
    ('sidospar', v_side),
    ('het', v_hot),
    ('medevac', v_med)
  ) as v(medal, n)
  union all
  select c.medal, count(*)::int from public.medal_claims c where c.user_id = p_uid group by c.medal;
end;
$$;
revoke all on function public.olnu_medal_eval(uuid) from public;

-- Store the result. Counts never go down; earned medals are never taken back.
create or replace function public.olnu_medal_store(p_uid uuid)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with e as (
    select x.medal as m, max(x.n)::int as n from public.olnu_medal_eval(p_uid) x where x.n >= 1 group by x.medal
  ),
  up as (
    insert into public.user_medals as um (user_id, medal, count, earned_at, updated_at)
    select p_uid, e.m, e.n, now(), now() from e
    on conflict on constraint user_medals_pkey do update
       set count = greatest(um.count, excluded.count), updated_at = now()
     where excluded.count > um.count
    returning um.medal, um.count, (um.earned_at = now()) as fresh, um.earned_at
  )
  select up.medal, up.count, up.fresh, up.earned_at from up;
end;
$$;
revoke all on function public.olnu_medal_store(uuid) from public;

-- ---------------------------------------------------------------------------
-- 7. RPCs (authenticated only)
-- ---------------------------------------------------------------------------

-- award_medals(p_event default null) -> setof (medal, count, is_new, earned_at): only the medals that
-- are new or whose count went up in this call. p_event = 'home': the caller pressed "Jag är hemma"
-- (counts only when the caller has a beer row tonight). Call after each beer, check-in, skål, chat,
-- rally answer and now and then while the app is open.
create or replace function public.award_medals(p_event text default null)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  if lower(btrim(coalesce(p_event, ''))) = 'home' then
    update public.medal_nights mn set home = true
      from public.beers b
     where b.user_id = v_uid and b.expires_at > now() and b.beer_count >= 1
       and mn.user_id = v_uid and mn.night = b.expires_at;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$$;

-- claim_medal(p_medal) -> setof (medal, count, is_new, earned_at). Only low-stakes medals the server
-- cannot see by itself. Unknown or not allowed ids -> raise invalid_medal. One claim per medal per night.
create or replace function public.claim_medal(p_medal text)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_m   text := lower(btrim(coalesce(p_medal, '')));
begin
  if v_m not in ('vatten', 'spoke', 'dagsljus', 'uggla', 'sidospar', 'hemvarn', 'radio', 'krogrunda') then
    raise exception 'invalid_medal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  -- Old local badges (migrated once): count only 1 per medal, ever, except "vatten" and "spoke".
  if v_m in ('vatten', 'spoke')
     or not exists (select 1 from public.medal_claims c where c.user_id = v_uid and c.medal = v_m) then
    insert into public.medal_claims (user_id, medal, night)
    values (v_uid, v_m, public.olnu_night_of(now()))
    on conflict do nothing;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$$;

-- my_medals() -> setof (medal, earned_at, count)
create or replace function public.my_medals()
returns table (medal text, earned_at timestamptz, count int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select um.medal, um.earned_at, um.count from public.user_medals um
   where um.user_id = v_uid order by um.earned_at, um.medal;
end;
$$;

-- member_medals(p_group_id) -> setof (name, is_me, medal, earned_at, count) for all members of a
-- group the caller is in. Error: not_member.
create or replace function public.member_medals(p_group_id uuid)
returns table (name text, is_me bool, medal text, earned_at timestamptz, count int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select gm.display_name, (gm.user_id = v_uid), um.medal, um.earned_at, um.count
    from public.group_members gm
    join public.user_medals um on um.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by gm.display_name, um.earned_at, um.medal
   limit 5000;
end;
$$;

do $$
declare
  f text;
  fns text[] := array[
    'public.award_medals(text)',
    'public.claim_medal(text)',
    'public.my_medals()',
    'public.member_medals(uuid)'
  ];
  internal text[] := array[
    'public.olnu_titles()',
    'public.olnu_night_of(timestamptz)',
    'public.olnu_evening(timestamptz)',
    'public.olnu_cell(float8, float8)',
    'public.olnu_medal_beers_tg()',
    'public.olnu_medal_checkin_tg()',
    'public.olnu_medal_skal_tg()',
    'public.olnu_medal_msg_tg()',
    'public.olnu_medal_eval(uuid)',
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
