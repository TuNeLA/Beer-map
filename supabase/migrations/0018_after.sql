-- Öl Nu v16 EFTERÅT (omgång 3: efteråt, socialt och krogar). Additive. Safe to run again.
-- Needs 0001-0015 (0014 optional: beer types; 0015 optional: bars_lite names).
-- * Kom hem säkert: mark_home(), home_status()           * "Jag kollar": claim_medevac(), medevac_checks()
-- * Bakisrapporten: my_night_report()                     * Öl Wrapped: my_wrapped()
-- * Högtidsläge: new holiday medals (olnu_medal_eval_after) * Röstmeddelande: post_voice(), group_voices(), voice_audio()
-- * Stad mot stad: city_league() (points, never total beers) * Stammis-krona: bar_regulars() (most NIGHTS, 30 days)
-- Rules: RLS on, no policies; SECURITY DEFINER + search_path; EXECUTE for authenticated only.
-- This file has no remove-type statements on purpose (create-or-replace, "if not exists",
-- "on conflict" only). Every trigger body catches its own errors: a bug here never blocks a beer,
-- a check-in or a skål. Rows are never removed; every read filters on time.

-- ---------------------------------------------------------------------------
-- 1. Towns (for Stad mot stad). Only a town name is ever stored per night, never a place.
-- ---------------------------------------------------------------------------
create table if not exists public.olnu_towns (
  name text primary key,
  lat  float8 not null,
  lng  float8 not null
);
alter table public.olnu_towns enable row level security;

insert into public.olnu_towns (name, lat, lng) values
  ('Stockholm', 59.3293, 18.0686), ('Göteborg', 57.7089, 11.9746), ('Malmö', 55.6050, 13.0038),
  ('Uppsala', 59.8586, 17.6389), ('Västerås', 59.6099, 16.5448), ('Örebro', 59.2753, 15.2134),
  ('Linköping', 58.4108, 15.6214), ('Helsingborg', 56.0465, 12.6945), ('Jönköping', 57.7826, 14.1618),
  ('Norrköping', 58.5877, 16.1924), ('Lund', 55.7047, 13.1910), ('Umeå', 63.8258, 20.2630),
  ('Gävle', 60.6749, 17.1413), ('Borås', 57.7210, 12.9401), ('Södertälje', 59.1955, 17.6253),
  ('Eskilstuna', 59.3666, 16.5077), ('Halmstad', 56.6745, 12.8578), ('Växjö', 56.8777, 14.8091),
  ('Karlstad', 59.3793, 13.5036), ('Sundsvall', 62.3908, 17.3069), ('Luleå', 65.5848, 22.1547),
  ('Trollhättan', 58.2837, 12.2886), ('Östersund', 63.1792, 14.6357), ('Borlänge', 60.4858, 15.4371),
  ('Falun', 60.6065, 15.6355), ('Kalmar', 56.6634, 16.3566), ('Kristianstad', 56.0294, 14.1567),
  ('Skövde', 58.3903, 13.8461), ('Karlskrona', 56.1612, 15.5869), ('Uddevalla', 58.3498, 11.9356),
  ('Varberg', 57.1056, 12.2508), ('Visby', 57.6348, 18.2948), ('Kiruna', 67.8558, 20.2253),
  ('Ludvika', 60.1496, 15.1878), ('Nyköping', 58.7530, 17.0079), ('Motala', 58.5371, 15.0365),
  ('Piteå', 65.3172, 21.4794), ('Skellefteå', 64.7507, 20.9528), ('Örnsköldsvik', 63.2909, 18.7153),
  ('Mora', 61.0070, 14.5430), ('Smedjebacken', 60.1405, 15.4128), ('Avesta', 60.1455, 16.1679),
  ('Hedemora', 60.2765, 15.9881), ('Säter', 60.3466, 15.7506), ('Leksand', 60.7307, 14.9993),
  ('Rättvik', 60.8857, 15.1199), ('Grängesberg', 60.0786, 14.9967), ('Malung', 60.6855, 13.7157),
  ('Vansbro', 60.5108, 14.2244), ('Orsa', 61.1203, 14.6153), ('Älvdalen', 61.2272, 14.0393),
  ('Fagersta', 60.0040, 15.7932), ('Kopparberg', 59.8740, 14.9950), ('Lindesberg', 59.5940, 15.2290),
  ('Sala', 59.9200, 16.6060), ('Sandviken', 60.6199, 16.7759), ('Hofors', 60.5460, 16.2870),
  ('Köping', 59.5140, 15.9930), ('Arboga', 59.3940, 15.8380), ('Enköping', 59.6360, 17.0770),
  ('Hudiksvall', 61.7290, 17.1040), ('Söderhamn', 61.3040, 17.0590), ('Bollnäs', 61.3480, 16.3940),
  ('Kristinehamn', 59.3090, 14.1080), ('Arvika', 59.6550, 12.5850), ('Lidköping', 58.5050, 13.1580),
  ('Alingsås', 57.9300, 12.5330), ('Kungsbacka', 57.4870, 12.0760), ('Ystad', 55.4290, 13.8200),
  ('Trelleborg', 55.3750, 13.1570), ('Landskrona', 55.8700, 12.8300), ('Västervik', 57.7580, 16.6370),
  ('Härnösand', 62.6320, 17.9380), ('Kramfors', 62.9310, 17.7770), ('Boden', 65.8250, 21.6890),
  ('Gällivare', 67.1330, 20.6600), ('Haparanda', 65.8350, 24.1370), ('Lycksele', 64.5950, 18.6760),
  ('Sälen', 61.1600, 13.2650), ('Åre', 63.3990, 13.0810)
on conflict (name) do update set lat = excluded.lat, lng = excluded.lng;

-- Nearest town within 30 km (null when none).
create or replace function public.olnu_town_of(p_lat float8, p_lng float8)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select t.name from public.olnu_towns t
   where p_lat is not null and p_lng is not null
     and abs(t.lat - p_lat) < 0.3 and abs(t.lng - p_lng) < 0.6
   order by (t.lat - p_lat) ^ 2 + ((t.lng - p_lng) * cos(radians(p_lat))) ^ 2
   limit 1;
$$;

-- Display name of p_user as seen by p_viewer: own name, or the name in a shared group, else null.
create or replace function public.olnu_name_for(p_viewer uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p_viewer = p_user
    then (select min(m.display_name) from public.group_members m where m.user_id = p_user)
    else (select min(t.display_name) from public.group_members t
            join public.group_members v on v.group_id = t.group_id and v.user_id = p_viewer
           where t.user_id = p_user) end;
$$;

create or replace function public.olnu_shares_group(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.group_members a
                   join public.group_members b on b.group_id = a.group_id and b.user_id = p_b
                  where a.user_id = p_a);
$$;

-- ---------------------------------------------------------------------------
-- 2. Night facts (one row per user per night; history starts with v16)
-- ---------------------------------------------------------------------------
create table if not exists public.after_nights (
  user_id    uuid not null,
  night      timestamptz not null,
  town       text,
  out        boolean not null default false,
  checkins   int not null default 0,
  skal_given int not null default 0,
  skal_got   int not null default 0,
  home_at    timestamptz,
  primary key (user_id, night)
);
create index if not exists after_nights_night_idx on public.after_nights (night);
alter table public.after_nights enable row level security;

create or replace function public.olnu_after_beers_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ob int := 0;
  v_oo int := 0;
begin
  begin
    if tg_op = 'UPDATE' then
      v_ob := coalesce(old.beer_count, 0);
      v_oo := coalesce(old.other_count, 0);
    end if;
    if coalesce(new.beer_count, 0) > v_ob or coalesce(new.other_count, 0) > v_oo then
      insert into public.after_nights as a (user_id, night, town, out)
      values (new.user_id, new.expires_at, public.olnu_town_of(new.lat, new.lng), true)
      on conflict (user_id, night) do update
         set out = true, town = coalesce(a.town, excluded.town);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_after_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_after_beers_tg();

create or replace function public.olnu_after_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' or new.created_at is distinct from old.created_at then
      insert into public.after_nights as a (user_id, night, town, checkins)
      values (new.user_id, public.olnu_night_of(now()), public.olnu_town_of(new.lat, new.lng), 1)
      on conflict (user_id, night) do update
         set checkins = a.checkins + 1, town = coalesce(a.town, excluded.town);
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_after_checkins
  after insert or update on public.checkins
  for each row execute function public.olnu_after_checkin_tg();

create or replace function public.olnu_after_skal_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_night timestamptz := public.olnu_night_of(now());
begin
  begin
    insert into public.after_nights as a (user_id, night, skal_given) values (new.user_id, v_night, 1)
    on conflict (user_id, night) do update set skal_given = a.skal_given + 1;
    select b.user_id into v_owner from public.beers b where b.id = new.beer_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.after_nights as a (user_id, night, skal_got) values (v_owner, v_night, 1)
      on conflict (user_id, night) do update set skal_got = a.skal_got + 1;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

create or replace trigger olnu_after_skals
  after insert on public.skals
  for each row execute function public.olnu_after_skal_tg();

-- Backfill tonight from live rows (only fills empty rows).
insert into public.after_nights (user_id, night, town, out)
select b.user_id, b.expires_at, public.olnu_town_of(b.lat, b.lng), true
  from public.beers b
 where b.expires_at > now() and (b.beer_count > 0 or coalesce(b.other_count, 0) > 0)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Kom hem säkert
-- ---------------------------------------------------------------------------
-- mark_home() -> jsonb {ok, home_at, reason?}. Needs a beer row tonight with a drink.
create or replace function public.mark_home()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_b   record;
  v_at  timestamptz;
begin
  select b.expires_at, b.lat, b.lng into v_b from public.beers b
   where b.user_id = v_uid and b.expires_at > now() and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_night');
  end if;
  insert into public.after_nights as a (user_id, night, town, out, home_at)
  values (v_uid, v_b.expires_at, public.olnu_town_of(v_b.lat, v_b.lng), true, now())
  on conflict (user_id, night) do update set home_at = coalesce(a.home_at, now()), out = true
  returning a.home_at into v_at;
  update public.medal_nights mn set home = true where mn.user_id = v_uid and mn.night = v_b.expires_at and not mn.home;
  return jsonb_build_object('ok', true, 'home_at', v_at);
end;
$$;

-- home_status(p_last default false) -> one row per member of each of the caller's groups.
-- p_last = false: tonight; true: last night (the morning-after card).
create or replace function public.home_status(p_last boolean default false)
returns table (group_id uuid, group_name text, name text, is_me boolean, beers int, others int,
               was_out boolean, home boolean, home_at timestamptz, live boolean, night timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := case when coalesce(p_last, false)
                           then public.olnu_night_of(now() - interval '24 hours')
                           else public.olnu_night_of(now()) end;
begin
  return query
  select g.id, g.name, gm.display_name, gm.user_id = v_uid,
         coalesce(mn.beers, 0), coalesce(mn.others, 0),
         coalesce(mn.beers, 0) + coalesce(mn.others, 0) > 0 or coalesce(an.out, false),
         an.home_at is not null or coalesce(mn.home, false),
         an.home_at,
         (not coalesce(p_last, false)) and exists (select 1 from public.beers b where b.user_id = gm.user_id
            and b.expires_at > now() and not b.stopped and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)),
         v_night
    from public.group_members me
    join public.groups g on g.id = me.group_id
    join public.group_members gm on gm.group_id = me.group_id
    left join public.medal_nights mn on mn.user_id = gm.user_id and mn.night = v_night
    left join public.after_nights an on an.user_id = gm.user_id and an.night = v_night
   where me.user_id = v_uid
   order by g.name, gm.display_name
   limit 1000;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. "Jag kollar" (MEDEVAC buddy check). First tap owns it.
-- ---------------------------------------------------------------------------
create table if not exists public.medevac_checks (
  id         bigserial primary key,
  target     uuid not null,
  night      timestamptz not null,
  checker    uuid not null,
  created_at timestamptz not null default now(),
  notified   boolean not null default false,
  unique (target, night)
);
create index if not exists medevac_checks_night_idx on public.medevac_checks (night);
alter table public.medevac_checks enable row level security;

-- claim_medevac(p_beer_id) -> jsonb {ok, mine, id, checker}. ok=false = someone was first.
-- Errors: beer_not_found (not live or under 10 beers), own_beer, not_friend.
create or replace function public.claim_medevac(p_beer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_b   record;
  v_row public.medevac_checks;
begin
  select b.user_id, b.expires_at, b.beer_count into v_b from public.beers b
   where b.id = p_beer_id and b.expires_at > now();
  if not found or coalesce(v_b.beer_count, 0) < 10 then
    raise exception 'beer_not_found';
  end if;
  if v_b.user_id = v_uid then
    raise exception 'own_beer';
  end if;
  if not public.olnu_shares_group(v_uid, v_b.user_id) then
    raise exception 'not_friend';
  end if;
  insert into public.medevac_checks (target, night, checker)
  values (v_b.user_id, v_b.expires_at, v_uid)
  on conflict (target, night) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('ok', true, 'mine', true, 'id', v_row.id, 'checker', public.olnu_name_for(v_uid, v_uid));
  end if;
  select * into v_row from public.medevac_checks c where c.target = v_b.user_id and c.night = v_b.expires_at;
  return jsonb_build_object('ok', false, 'mine', v_row.checker = v_uid, 'id', v_row.id,
    'checker', public.olnu_name_for(v_uid, v_row.checker));
end;
$$;

-- medevac_checks() -> tonight's checks the caller may see (target or checker is the caller or a group-mate).
create or replace function public.medevac_checks()
returns table (id bigint, beer_id bigint, target_name text, checker_name text,
               target_is_me boolean, checker_is_me boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select c.id, b.id, public.olnu_name_for(v_uid, c.target), public.olnu_name_for(v_uid, c.checker),
         c.target = v_uid, c.checker = v_uid, c.created_at
    from public.medevac_checks c
    left join public.beers b on b.user_id = c.target and b.expires_at = c.night
   where c.night > now()
     and (c.target = v_uid or c.checker = v_uid
          or public.olnu_shares_group(v_uid, c.target) or public.olnu_shares_group(v_uid, c.checker))
   order by c.created_at desc
   limit 50;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Bakisrapporten: my_night_report(p_last default true) -> jsonb
-- ---------------------------------------------------------------------------
create or replace function public.my_night_report(p_last boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := case when coalesce(p_last, true)
                           then public.olnu_night_of(now() - interval '24 hours')
                           else public.olnu_night_of(now()) end;
  v_mn    record;
  v_an    record;
  v_bars  int := 0;
  v_types jsonb := '[]'::jsonb;
  v_week  int := 0;
begin
  select mn.beers, mn.others, mn.first_at, mn.home into v_mn from public.medal_nights mn
   where mn.user_id = v_uid and mn.night = v_night;
  select an.checkins, an.skal_given, an.skal_got, an.home_at, an.town into v_an from public.after_nights an
   where an.user_id = v_uid and an.night = v_night;
  select count(distinct c.bar_id) into v_bars from public.medal_checkins c where c.user_id = v_uid and c.night = v_night;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'n', x.n) order by x.n desc), '[]'::jsonb) into v_types
      from (select bt.type, count(*)::int n from public.beer_types bt
             where bt.user_id = v_uid and bt.night = v_night group by bt.type) x;
  exception when others then
    v_types := '[]'::jsonb;
  end;
  select count(*) into v_week from public.medal_nights mn
   where mn.user_id = v_uid and mn.night < v_night and mn.night >= v_night - interval '7 days'
     and mn.beers + mn.others > 0;
  return jsonb_build_object(
    'night', v_night,
    'evening', public.olnu_evening(v_night),
    'out', coalesce(v_mn.beers, 0) + coalesce(v_mn.others, 0) > 0,
    'beers', coalesce(v_mn.beers, 0),
    'others', coalesce(v_mn.others, 0),
    'first_at', v_mn.first_at,
    'bars', coalesce(v_bars, 0),
    'checkins', coalesce(v_an.checkins, 0),
    'skal_given', coalesce(v_an.skal_given, 0),
    'skal_got', coalesce(v_an.skal_got, 0),
    'home', v_an.home_at is not null or coalesce(v_mn.home, false),
    'home_at', v_an.home_at,
    'town', v_an.town,
    'types', v_types,
    'nights_week_before', coalesce(v_week, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Öl Wrapped: my_wrapped(p_kind 'month'|'year', p_offset default 1) -> jsonb
--    offset 1 = last month / last year, 0 = this one so far. Evenings (the day the night started).
-- ---------------------------------------------------------------------------
create or replace function public.my_wrapped(p_kind text default 'month', p_offset int default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_kind text := case when lower(coalesce(p_kind, '')) = 'year' then 'year' else 'month' end;
  v_off  int := greatest(0, least(24, coalesce(p_offset, 1)));
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  v_from date;
  v_to   date;
  v_nights int := 0; v_beers int := 0; v_others int := 0; v_home int := 0;
  v_bars int := 0; v_sg int := 0; v_sr int := 0; v_towns int := 0;
  v_fav record; v_best record; v_type text; v_type_n int := 0;
  v_fav_name text;
  v_total int := public.olnu_lifetime(v_uid);
  v_title text;
begin
  if v_kind = 'year' then
    v_from := (date_trunc('year', v_today) - make_interval(years => v_off))::date;
    v_to := (v_from + interval '1 year')::date - 1;
  else
    v_from := (date_trunc('month', v_today) - make_interval(months => v_off))::date;
    v_to := (v_from + interval '1 month')::date - 1;
  end if;

  select count(*) filter (where mn.beers + mn.others > 0), coalesce(sum(mn.beers), 0), coalesce(sum(mn.others), 0),
         count(*) filter (where mn.home and mn.beers + mn.others > 0)
    into v_nights, v_beers, v_others, v_home
    from public.medal_nights mn
   where mn.user_id = v_uid and public.olnu_evening(mn.night) between v_from and v_to;

  select count(distinct c.bar_id) into v_bars from public.medal_checkins c
   where c.user_id = v_uid and public.olnu_evening(c.night) between v_from and v_to;

  select c.bar_id, count(distinct c.night)::int n into v_fav from public.medal_checkins c
   where c.user_id = v_uid and public.olnu_evening(c.night) between v_from and v_to
   group by c.bar_id order by count(distinct c.night) desc, max(c.night) desc limit 1;
  if v_fav.bar_id is not null then
    begin
      select bl.name into v_fav_name from public.bars_lite bl where bl.id = v_fav.bar_id;
    exception when others then
      v_fav_name := null;
    end;
    if v_fav_name is null then
      select t.bar_name into v_fav_name from public.bar_taps t where t.bar_id = v_fav.bar_id and t.bar_name is not null
       order by t.last_at desc limit 1;
    end if;
    if v_fav_name is null then
      select c.bar_name into v_fav_name from public.checkins c where c.bar_id = v_fav.bar_id order by c.created_at desc limit 1;
    end if;
  end if;

  select coalesce(sum(an.skal_given), 0), coalesce(sum(an.skal_got), 0),
         count(distinct an.town) filter (where an.town is not null),
         greatest(v_home, count(*) filter (where an.home_at is not null))
    into v_sg, v_sr, v_towns, v_home
    from public.after_nights an
   where an.user_id = v_uid and public.olnu_evening(an.night) between v_from and v_to;

  -- Best night: the most social one (bars, skål, home safe), beers only break ties. Never "most beers".
  select public.olnu_evening(mn.night) as evening, mn.beers,
         coalesce((select count(distinct c.bar_id) from public.medal_checkins c where c.user_id = v_uid and c.night = mn.night), 0) as bars
    into v_best
    from public.medal_nights mn
    left join public.after_nights an on an.user_id = mn.user_id and an.night = mn.night
   where mn.user_id = v_uid and public.olnu_evening(mn.night) between v_from and v_to and mn.beers + mn.others > 0
   order by coalesce((select count(distinct c.bar_id) from public.medal_checkins c where c.user_id = v_uid and c.night = mn.night), 0) * 3
            + coalesce(an.skal_given, 0) + coalesce(an.skal_got, 0) + case when an.home_at is not null or mn.home then 2 else 0 end desc,
            mn.beers desc, mn.night desc
   limit 1;

  begin
    select bt.type, count(*)::int into v_type, v_type_n from public.beer_types bt
     where bt.user_id = v_uid and public.olnu_evening(bt.night) between v_from and v_to
     group by bt.type order by count(*) desc, max(bt.created_at) desc limit 1;
  exception when others then
    v_type := null; v_type_n := 0;
  end;

  select t.title into v_title from public.olnu_titles() t where t.at <= v_total order by t.at desc limit 1;

  return jsonb_build_object(
    'kind', v_kind, 'from', v_from, 'to', v_to,
    'nights', coalesce(v_nights, 0), 'beers', coalesce(v_beers, 0), 'others', coalesce(v_others, 0),
    'home_nights', coalesce(v_home, 0), 'bars', coalesce(v_bars, 0), 'towns', coalesce(v_towns, 0),
    'skal_given', coalesce(v_sg, 0), 'skal_got', coalesce(v_sr, 0),
    'fav_bar_id', v_fav.bar_id, 'fav_bar_name', v_fav_name, 'fav_bar_nights', coalesce(v_fav.n, 0),
    'best_evening', v_best.evening, 'best_beers', coalesce(v_best.beers, 0), 'best_bars', coalesce(v_best.bars, 0),
    'top_type', v_type, 'top_type_n', coalesce(v_type_n, 0),
    'total', coalesce(v_total, 0), 'title', v_title);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Högtidsläge: more holiday medals (0012 has valborg, midsommar, lucia, nyar)
-- ---------------------------------------------------------------------------
-- Easter Sunday (Gregorian, anonymous algorithm).
create or replace function public.olnu_easter(p_year int)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  a int := p_year % 19; b int := p_year / 100; c int := p_year % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_year, mo, dy);
end;
$$;

-- Holiday id of an evening date (null = none). Same rules as docs/js/after.js holidayOf().
create or replace function public.olnu_holiday(p_day date)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_md  text := to_char(p_day, 'MM-DD');
  v_dow int := extract(isodow from p_day)::int;
  v_e   date := public.olnu_easter(extract(year from p_day)::int);
  v_adv date;
begin
  if v_md = '12-24' then return 'julafton'; end if;
  if v_md = '12-31' then return 'nyarsafton'; end if;
  if v_md = '12-13' then return 'lucia'; end if;
  if v_md = '04-30' then return 'valborg'; end if;
  if v_md = '10-31' then return 'halloween'; end if;
  if v_dow = 5 and v_md between '06-19' and '06-25' then return 'midsommar'; end if;
  if p_day between v_e - 2 and v_e then return 'pask'; end if;
  if p_day = v_e - 47 then return 'fettisdagen'; end if;
  -- First Sunday of Advent: the Sunday between 27 Nov and 3 Dec.
  v_adv := make_date(extract(year from p_day)::int, 12, 3);
  v_adv := v_adv - (extract(isodow from v_adv)::int % 7);
  if p_day = v_adv then return 'forstaAdvent'; end if;
  if v_dow = 5 and extract(day from p_day) = 13 then return 'fredag13'; end if;
  if v_dow = 5 and extract(month from p_day) = 8 then return 'kraftskiva'; end if;
  return null;
end;
$$;

-- New medal ids: jul, fettis, pask, advent, fredag13, halloween, kraftskiva (stack per year;
-- fredag13 per occurrence) and kompisvakt (said "🚑 Jag kollar" for a friend; stacks). Caring, never a drinking goal.
create or replace function public.olnu_medal_eval_after(p_uid uuid)
returns table (medal text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_jul int := 0; v_fett int := 0; v_pask int := 0; v_adv int := 0; v_f13 int := 0; v_hall int := 0; v_kraft int := 0;
  v_kv int := 0;
begin
  begin
    select count(distinct extract(year from x.ev)) filter (where x.h = 'julafton'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'fettisdagen'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'pask'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'forstaAdvent'),
           count(distinct x.ev) filter (where x.h = 'fredag13'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'halloween'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'kraftskiva')
      into v_jul, v_fett, v_pask, v_adv, v_f13, v_hall, v_kraft
      from (select public.olnu_evening(mn.night) as ev, public.olnu_holiday(public.olnu_evening(mn.night)) as h
              from public.medal_nights mn where mn.user_id = p_uid and mn.beers >= 1) x
     where x.h is not null;
    select count(*) into v_kv from public.medevac_checks c where c.checker = p_uid;
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('jul', v_jul), ('fettis', v_fett), ('pask', v_pask), ('advent', v_adv),
    ('fredag13', v_f13), ('halloween', v_hall), ('kraftskiva', v_kraft), ('kompisvakt', v_kv)
  ) as v(medal, n);
end;
$$;

-- Same name and return type as 0012/0014. Now unions EVERY public function named
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

-- ---------------------------------------------------------------------------
-- 8. Röstmeddelande (voice skål, max 5 s / 60 KB, lives until 05:00, group members only)
-- ---------------------------------------------------------------------------
create table if not exists public.voice_msgs (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  mime       text not null,
  dur_ms     int not null default 0,
  audio      bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default public.olnu_next_expiry(),
  notified   boolean not null default false
);
create index if not exists voice_msgs_group_idx on public.voice_msgs (group_id, id);
create index if not exists voice_msgs_user_idx on public.voice_msgs (user_id, created_at);
alter table public.voice_msgs enable row level security;

-- post_voice -> jsonb {id, created_at, left}. Errors: not_member, invalid_voice, voice_limit (10 per night), slow_down (5 s).
create or replace function public.post_voice(p_group_id uuid, p_mime text, p_b64 text, p_dur_ms int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_mime text := lower(btrim(coalesce(p_mime, '')));
  v_data bytea;
  v_n    int;
  v_row  public.voice_msgs;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_mime !~ '^audio/(webm|ogg|mp4|aac|mpeg|x-m4a)(; ?codecs="?[a-z0-9.,]{1,30}"?)?$' then
    raise exception 'invalid_voice';
  end if;
  if p_b64 is null or length(p_b64) > 90000 then
    raise exception 'invalid_voice';
  end if;
  begin
    v_data := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_voice';
  end;
  if octet_length(v_data) < 100 or octet_length(v_data) > 61440 then
    raise exception 'invalid_voice';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_voice:' || v_uid::text, 0));
  if exists (select 1 from public.voice_msgs v where v.user_id = v_uid and v.created_at > now() - interval '5 seconds') then
    raise exception 'slow_down';
  end if;
  select count(*) into v_n from public.voice_msgs v where v.user_id = v_uid and v.expires_at = public.olnu_next_expiry();
  if v_n >= 10 then
    raise exception 'voice_limit';
  end if;
  insert into public.voice_msgs (group_id, user_id, mime, dur_ms, audio)
  values (p_group_id, v_uid, v_mime, greatest(0, least(6000, coalesce(p_dur_ms, 0))), v_data)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'left', 9 - v_n);
end;
$$;

-- group_voices(p_group_id, p_after_id default 0) -> live voice messages (no audio), oldest first, max 30.
create or replace function public.group_voices(p_group_id uuid, p_after_id bigint default 0)
returns table (id bigint, name text, mime text, dur_ms int, bytes int, created_at timestamptz, is_me boolean)
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
  select x.id, x.name, x.mime, x.dur_ms, x.bytes, x.created_at, x.is_me from (
    select v.id, gm.display_name as name, v.mime, v.dur_ms, octet_length(v.audio) as bytes, v.created_at, v.user_id = v_uid as is_me
      from public.voice_msgs v
      left join public.group_members gm on gm.group_id = v.group_id and gm.user_id = v.user_id
     where v.group_id = p_group_id and v.expires_at > now() and v.id > coalesce(p_after_id, 0)
     order by v.id desc limit 30) x
   order by x.id;
end;
$$;

-- voice_audio(p_id) -> jsonb {id, mime, b64}. Errors: voice_not_found, not_member.
create or replace function public.voice_audio(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.voice_msgs;
begin
  select * into v_row from public.voice_msgs v where v.id = p_id and v.expires_at > now();
  if not found then
    raise exception 'voice_not_found';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'dur_ms', v_row.dur_ms,
    'b64', replace(encode(v_row.audio, 'base64'), E'\n', ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Stad mot stad: weekly town league. NOT total beers (no competition drinking).
--    Per user and night in the town: 1 night out + 1 home safe + 0.5 per check-in (max 5) + 0.25 per skål given (max 10).
--    poäng = round(10 * sum / active users). Ranked only with >= 3 active users.
-- ---------------------------------------------------------------------------
create or replace function public.city_league(p_week_offset int default 0)
returns table (rank int, town text, points int, users int, nights int, checkins int, skal int, home int, is_mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_from date := public.olnu_week_start(now()) - 7 * greatest(0, least(52, coalesce(p_week_offset, 0)));
  v_to   date := v_from + 6;
  v_mine text;
begin
  select an.town into v_mine from public.after_nights an
   where an.user_id = v_uid and an.town is not null and public.olnu_evening(an.night) between v_from and v_to
   group by an.town order by count(*) desc, max(an.night) desc limit 1;
  if v_mine is null then
    select an.town into v_mine from public.after_nights an
     where an.user_id = v_uid and an.town is not null order by an.night desc limit 1;
  end if;
  return query
  with f as (
    select an.town as tw, an.user_id as u,
           case when an.out then 1 else 0 end as o,
           case when an.out and an.home_at is not null then 1 else 0 end as h,
           least(an.checkins, 5) as c, least(an.skal_given, 10) as s
      from public.after_nights an
     where an.town is not null and public.olnu_evening(an.night) between v_from and v_to
       and (an.out or an.checkins > 0 or an.skal_given > 0)
  ),
  t as (
    select f.tw, count(distinct f.u)::int as us, sum(f.o)::int as ni, sum(f.c)::int as ci, sum(f.s)::int as sk, sum(f.h)::int as ho,
           round(10.0 * (sum(f.o) + sum(f.h) + 0.5 * sum(f.c) + 0.25 * sum(f.s)) / greatest(1, count(distinct f.u)))::int as pts
      from f group by f.tw
  ),
  r as (
    select t.*, case when t.us >= 3 then (row_number() over (order by (t.us >= 3) desc, t.pts desc, t.us desc, t.tw))::int end as rk
      from t
  )
  select r.rk, r.tw, r.pts, r.us, r.ni, r.ci, r.sk, r.ho, r.tw = v_mine
    from r
   where (r.rk is not null and r.rk <= 12) or r.tw = v_mine
   order by r.rk nulls last, r.tw;
  if v_mine is not null and not exists (select 1 from public.after_nights an where an.town = v_mine
       and public.olnu_evening(an.night) between v_from and v_to) then
    return query select null::int, v_mine, 0, 0, 0, 0, 0, 0, true;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Stammis-krona: most NIGHTS at a bar in the last 30 days (not most beers). bar_kings stays for old apps.
--     bar_regulars(p_bar_id) -> top 3 (min 2 nights) + the caller's own row. Names only for self / group-mates.
-- ---------------------------------------------------------------------------
create or replace function public.bar_regulars(p_bar_id text)
returns table (rank int, name text, nights int, is_me boolean, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with n as (
    select c.user_id as u, count(distinct c.night)::int as k, max(c.night) as la
      from public.medal_checkins c
     where c.bar_id = left(coalesce(p_bar_id, ''), 80) and c.night > now() - interval '30 days'
     group by c.user_id
  ),
  r as (select n.*, (row_number() over (order by n.k desc, n.la asc, n.u))::int as rk from n)
  select r.rk, public.olnu_name_for(v_uid, r.u), r.k, r.u = v_uid, r.la
    from r
   where (r.rk <= 3 and r.k >= 2) or r.u = v_uid
   order by r.rk;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
revoke all on table public.olnu_towns, public.after_nights, public.medevac_checks, public.voice_msgs from public;
do $$
declare
  f text;
  fns text[] := array[
    'public.mark_home()',
    'public.home_status(boolean)',
    'public.claim_medevac(bigint)',
    'public.medevac_checks()',
    'public.my_night_report(boolean)',
    'public.my_wrapped(text, integer)',
    'public.post_voice(uuid, text, text, integer)',
    'public.group_voices(uuid, bigint)',
    'public.voice_audio(bigint)',
    'public.city_league(integer)',
    'public.bar_regulars(text)'
  ];
  internal text[] := array[
    'public.olnu_town_of(double precision, double precision)',
    'public.olnu_name_for(uuid, uuid)',
    'public.olnu_shares_group(uuid, uuid)',
    'public.olnu_after_beers_tg()',
    'public.olnu_after_checkin_tg()',
    'public.olnu_after_skal_tg()',
    'public.olnu_easter(integer)',
    'public.olnu_holiday(date)',
    'public.olnu_medal_eval_after(uuid)',
    'public.olnu_medal_store(uuid)'
  ];
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.olnu_towns, public.after_nights, public.medevac_checks, public.voice_msgs from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.olnu_towns, public.after_nights, public.medevac_checks, public.voice_msgs from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.olnu_towns, public.after_nights, public.medevac_checks, public.voice_msgs to service_role';
    execute 'grant usage, select on sequence public.medevac_checks_id_seq, public.voice_msgs_id_seq to service_role';
  end if;
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
